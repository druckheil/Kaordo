<script lang="ts">
  import type { NodoNode, NodoPolicy, NodoStorageSpace, NodoTelemetryField } from '../../lib/domain/nodo';
  import type { NodoSnapshot } from '../../lib/states/NodoGState';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    onClear: (nodeId: string) => void | Promise<boolean>;
    onClearPrivate: (nodeId: string) => void | Promise<boolean>;
    onDelete: (nodeId: string) => void | Promise<boolean>;
    onList: (nodeId: string, space: NodoStorageSpace) => void | Promise<void>;
    onRename: (nodeId: string, name: string) => void | Promise<boolean>;
    onPolicy: (nodeId: string, policy: Omit<NodoPolicy, 'ownerOnly'>) => void | Promise<boolean>;
    onQuickTest: (nodeId: string) => void | Promise<boolean>;
    onRefresh: () => void | Promise<void>;
    onSpaces: (nodeId: string, publicQuotaBytes: number) => void | Promise<boolean>;
    snapshot: Readonly<NodoSnapshot>;
  };

  let { onClear, onClearPrivate, onDelete, onList, onRename, onPolicy, onQuickTest, onRefresh, onSpaces, snapshot }: Props = $props();
  let selectedId = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let confirmingClear = $state(false);
  let confirmingPrivateClear = $state(false);
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let publicDrafts = $state<Record<string, number>>({});
  let selected = $derived(
    snapshot.nodes.find((node) => node.id === selectedId) ?? snapshot.nodes[0] ?? null,
  );
  let onlineCount = $derived(snapshot.nodes.filter((node) => node.online).length);
  let totalQuota = $derived(snapshot.nodes.reduce((total, node) => total + node.quotaBytes, 0));
  let totalUsed = $derived(snapshot.nodes.reduce((total, node) => total + node.usedBytes, 0));

  function bytes(value: number | null, speed = false): string {
    if (value === null) return 'Waiting for host';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let unit = 0;
    while (amount >= 1_024 && unit < units.length - 1) { amount /= 1_024; unit += 1; }
    const precision = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(precision)} ${units[unit]}${speed ? '/s' : ''}`;
  }

  function isLinuxHost(node: NodoNode): boolean {
    return node.metrics.androidSdk === null && node.metrics.appVersion !== null;
  }

  function isBatterylessHost(node: NodoNode): boolean {
    return isLinuxHost(node) && node.metrics.batteryPercent === null && node.metrics.charging === null;
  }

  function telemetryState(node: NodoNode, field: NodoTelemetryField): 'error' | 'loading' | 'ready' {
    const test = snapshot.telemetryTest;
    return test?.nodeId === node.id ? test.fields[field] : 'ready';
  }

  function telemetryWaiting(node: NodoNode): string {
    return isLinuxHost(node) ? 'Awaiting telemetry' : 'Waiting for host';
  }

  function metricBytes(node: NodoNode, value: number | null, speed = false, empty = telemetryWaiting(node)): string {
    return value === null ? empty : bytes(value, speed);
  }

  function relative(timestamp: number): string {
    const seconds = Math.max(0, Math.floor(Date.now() / 1_000 - timestamp));
    if (seconds < 45) return 'Just now';
    if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
    return `${Math.floor(seconds / 86_400)}d ago`;
  }

  function percent(used: number, total: number): number {
    return Math.min(100, Math.max(0, used / Math.max(1, total) * 100));
  }

  function networkLabel(node: NodoNode): string {
    const type = node.metrics.networkType;
    if (!type) return telemetryWaiting(node);
    const label = type === 'wifi' ? 'Wi-Fi' : `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`;
    return node.metrics.networkMetered ? `${label} · metered` : label;
  }

  function batteryLabel(node: NodoNode): string {
    if (isLinuxHost(node) && node.metrics.batteryPercent === null) return 'Not available on Linux';
    if (node.metrics.batteryPercent === null) return 'Waiting for host';
    return `${node.metrics.batteryPercent}%${node.metrics.charging ? ' · charging' : ''}`;
  }

  function memoryLabel(node: NodoNode): string {
    const available = node.metrics.memoryAvailableBytes;
    const total = node.metrics.memoryTotalBytes;
    return available === null || total === null ? telemetryWaiting(node) : `${bytes(available)} free of ${bytes(total)}`;
  }

  function latencyLabel(node: NodoNode): string {
    const value = node.metrics.coordinatorLatencyMs;
    return value === null ? telemetryWaiting(node) : `${value} ms to coordinator`;
  }

  type MetricKind = 'battery' | 'connection' | 'download' | 'latency' | 'memory' | 'read' | 'upload' | 'write';

  function metricScore(node: NodoNode, kind: MetricKind): number | null {
    if (!node.online) return 0;
    const metrics = node.metrics;
    switch (kind) {
      case 'battery': {
        if (metrics.batteryPercent === null) return null;
        const base = scale(metrics.batteryPercent, 8, 78);
        return clamp(base + (metrics.charging ? 0.2 : 0));
      }
      case 'memory': {
        if (metrics.memoryAvailableBytes === null || metrics.memoryTotalBytes === null) return null;
        return scale(metrics.memoryAvailableBytes / Math.max(1, metrics.memoryTotalBytes), 0.04, 0.4);
      }
      case 'connection': {
        const base = { cellular: 0.48, ethernet: 1, offline: 0, other: 0.42, wifi: 0.9 }[metrics.networkType ?? 'offline'];
        return clamp(base - (metrics.networkMetered ? 0.25 : 0));
      }
      case 'latency': return inverseLogScore(metrics.coordinatorLatencyMs, 18, 650);
      case 'download': return logScore(metrics.networkDownBps, 500_000, 120_000_000);
      case 'upload': return logScore(metrics.networkUpBps, 250_000, 60_000_000);
      case 'read': return logScore(metrics.diskReadBps, 8_000_000, 500_000_000);
      case 'write': return logScore(metrics.diskWriteBps, 4_000_000, 250_000_000);
    }
  }

  function healthStyle(score: number | null): string {
    if (score === null) return '--health-bg:#fff;--health-border:#e4e9e5;--health-accent:#819087;--health-icon:#edf4f0';
    const hue = healthHue(score);
    return `--health-bg:hsl(${hue} 52% 97%);--health-border:hsl(${hue} 34% 86%);--health-accent:hsl(${hue} 43% 42%);--health-icon:hsl(${hue} 48% 92%)`;
  }

  function healthLabel(score: number | null): string {
    if (score === null) return 'Waiting for data';
    if (score >= 0.85) return 'Excellent';
    if (score >= 0.65) return 'Good';
    if (score >= 0.45) return 'Fair';
    if (score >= 0.25) return 'Weak';
    return 'Poor';
  }

  function metricHealthLabel(node: NodoNode, kind: MetricKind): string {
    return kind === 'battery' && isBatterylessHost(node)
      ? 'Not applicable'
      : healthLabel(metricScore(node, kind));
  }

  function storageScore(node: NodoNode): number {
    return 1 - clamp(node.usedBytes / Math.max(1, node.quotaBytes));
  }

  function storageStyle(node: NodoNode): string {
    const hue = healthHue(storageScore(node));
    return `--storage-accent:hsl(${hue} 52% 62%);--used:${percent(node.usedBytes, node.quotaBytes) * 3.6}deg`;
  }

  function healthHue(score: number): number {
    const stops = [
      { at: 0, hue: 342 },
      { at: 0.14, hue: 8 },
      { at: 0.36, hue: 46 },
      { at: 0.58, hue: 76 },
      { at: 1, hue: 145 },
    ];
    const value = clamp(score);
    for (let index = 1; index < stops.length; index += 1) {
      const next = stops[index]!;
      const previous = stops[index - 1]!;
      if (value > next.at) continue;
      let nextHue = next.hue;
      if (previous.hue > 300 && nextHue < 30) nextHue += 360;
      const progress = (value - previous.at) / (next.at - previous.at);
      return Math.round((previous.hue + (nextHue - previous.hue) * progress) % 360);
    }
    return 145;
  }

  function logScore(value: number | null, poor: number, excellent: number): number | null {
    if (value === null) return null;
    return clamp((Math.log(Math.max(1, value)) - Math.log(poor)) / (Math.log(excellent) - Math.log(poor)));
  }

  function inverseLogScore(value: number | null, excellent: number, poor: number): number | null {
    const score = logScore(value, excellent, poor);
    return score === null ? null : 1 - score;
  }

  function scale(value: number, poor: number, excellent: number): number {
    return clamp((value - poor) / (excellent - poor));
  }

  function clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  function selectNode(nodeId: string) {
    selectedId = nodeId;
    renamingId = null;
    renameDraft = '';
    confirmingClear = false;
    confirmingPrivateClear = false;
    confirmingDelete = false;
  }

  function startRename(node: NodoNode) {
    renamingId = node.id;
    renameDraft = node.deviceName;
  }

  function cancelRename() {
    renamingId = null;
    renameDraft = '';
  }

  async function saveRename(node: NodoNode) {
    const saved = await onRename(node.id, renameDraft);
    if (saved) cancelRename();
  }

  function toggle(node: NodoNode, key: keyof Omit<NodoPolicy, 'ownerOnly'>) {
    const { ownerOnly: _, ...policy } = node.policy;
    void onPolicy(node.id, { ...policy, [key]: !policy[key] });
  }

  function publicDraft(node: NodoNode): number {
    return publicDrafts[node.id] ?? node.spaces.public.quotaBytes;
  }

  function supportsSpaces(node: NodoNode): boolean {
    const match = node.metrics.appVersion?.match(/^(\d+)\.(\d+)(?:\.|$)/);
    return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 1));
  }

  function setPublicDraft(node: NodoNode, value: number) {
    publicDrafts[node.id] = Math.round(Math.min(node.quotaBytes, Math.max(0, value)));
  }

  function selectMode(node: NodoNode, mode: 'mixed' | 'private' | 'public') {
    if (mode === 'private') return setPublicDraft(node, 0);
    if (mode === 'public') return setPublicDraft(node, node.quotaBytes);
    const minimum = node.spaces.public.usedBytes;
    const maximum = node.quotaBytes - node.spaces.private.usedBytes;
    setPublicDraft(node, Math.min(maximum, Math.max(minimum, node.quotaBytes / 2)));
  }

  function nodeMode(node: NodoNode, publicQuotaBytes = node.spaces.public.quotaBytes): string {
    if (publicQuotaBytes <= 0) return 'Private';
    if (publicQuotaBytes >= node.quotaBytes) return 'Public';
    return 'Public + Private';
  }

  function fleetMode(nodes: readonly NodoNode[]): string {
    const modes = [...new Set(nodes.map((node) => nodeMode(node)))];
    return modes.length === 1 ? modes[0]! : 'Mixed modes';
  }

  function spacePercent(usedBytes: number, quotaBytes: number): number {
    if (quotaBytes <= 0) return usedBytes > 0 ? 100 : 0;
    return percent(usedBytes, quotaBytes);
  }

  function allocationNotice(node: NodoNode): string {
    const publicBytes = publicDraft(node);
    if (publicBytes === node.quotaBytes && node.spaces.private.usedBytes > 0) {
      return 'Private content will be moved into Public and become publicly writable under its author permissions.';
    }
    if (publicBytes === 0 && node.spaces.public.usedBytes > 0) {
      return 'Public content will be moved into Private; future writes will become owner-only.';
    }
    return 'Both spaces use separate directories, quotas and write permissions.';
  }

  async function saveSpaces(node: NodoNode) {
    const saved = await onSpaces(node.id, publicDraft(node));
    if (saved) delete publicDrafts[node.id];
  }

  async function removeSelected(node: NodoNode) {
    const removed = await onDelete(node.id);
    if (removed) {
      confirmingDelete = false;
      selectedId = null;
    }
  }


  async function clearSelected(node: NodoNode) {
    const cleared = await onClear(node.id);
    if (cleared) confirmingClear = false;
  }

  async function clearPrivateSelected(node: NodoNode) {
    const cleared = await onClearPrivate(node.id);
    if (cleared) confirmingPrivateClear = false;
  }
</script>

<main class="nodo-shell" aria-labelledby="nodo-title">
  <div class="nodo-layout">
    <header class="nodo-heading">
      <div>
        <span class="eyebrow">Personal infrastructure</span>
        <h1 id="nodo-title">Nodo</h1>
        <p>Your devices form a private storage network under your control.</p>
      </div>
      <button class="refresh-button" type="button" disabled={snapshot.phase === 'loading'} onclick={onRefresh}>
        {#if snapshot.phase === 'loading'}<LoadingSpinner compact />{:else}<span aria-hidden="true">↻</span>{/if}
        Refresh
      </button>
    </header>

    {#if snapshot.error}<p class="inline-error" role="alert">{snapshot.error}</p>{/if}

    {#if snapshot.phase === 'loading' && snapshot.nodes.length === 0}
      <section class="loading-card" aria-label="Loading nodes"><LoadingSpinner /><span>Finding your nodes…</span></section>
    {:else if snapshot.nodes.length === 0}
      <section class="empty-card">
        <div class="empty-mark" aria-hidden="true"><i></i><i></i><i></i></div>
        <span class="eyebrow">No hosts connected</span>
        <h2>Set up your first Nodo</h2>
        <p>Sign in to Kaordo Nodo on an Android device, choose a storage limit and keep its status notification active.</p>
        <button type="button" onclick={onRefresh}>Check again</button>
      </section>
    {:else}
      <section class="fleet-summary" aria-label="Node fleet summary">
        <article><span>Nodes</span><strong>{snapshot.nodes.length}</strong><small>{onlineCount} online now</small></article>
        <article><span>Allocated</span><strong>{bytes(totalQuota)}</strong><small>across your devices</small></article>
        <article><span>Stored</span><strong>{bytes(totalUsed)}</strong><small>{percent(totalUsed, totalQuota).toFixed(1)}% of allocation</small></article>
        <article class="privacy-stat"><span>Spaces</span><strong>{fleetMode(snapshot.nodes)}</strong><small>{snapshot.nodes.length === 1 ? 'current node mode' : 'across your devices'}</small></article>
      </section>

      <div class="nodo-grid">
        <aside class="node-list" aria-label="Your nodes">
          <header><span>Your nodes</span><small>{onlineCount}/{snapshot.nodes.length} online</small></header>
          {#each snapshot.nodes as node (node.id)}
            <button
              class:active={selected?.id === node.id}
              class="node-item"
              type="button"
              onclick={() => selectNode(node.id)}
            >
              <span class:online={node.online} class="node-icon"><i></i></span>
              <span class="node-copy">
                <strong>{node.deviceName}</strong>
                <small>{node.online ? `Online · ${nodeMode(node)}` : `Last seen ${relative(node.lastSeenAt)}`}</small>
              </span>
              <span class="node-space">{bytes(node.quotaBytes)}</span>
            </button>
          {/each}
          <p class="list-note">Hosts refresh automatically every 30 seconds.</p>
        </aside>

        {#if selected}
          <section class="node-detail" aria-label={`${selected.deviceName} controls`}>
            <header class="device-header">
              <div class="device-title">
                <span class:online={selected.online} class="status-dot"></span>
                <div>
                  {#if renamingId === selected.id}
                    <form class="rename-form" onsubmit={(event) => { event.preventDefault(); void saveRename(selected); }}>
                      <input bind:value={renameDraft} maxlength="80" aria-label="Nodo name" />
                      <button type="submit" disabled={snapshot.operation !== null || !renameDraft.trim()} aria-label="Save Nodo name">Save</button>
                      <button type="button" class="rename-cancel" disabled={snapshot.operation !== null} onclick={cancelRename}>Cancel</button>
                    </form>
                  {:else}
                    <div class="name-row">
                      <h2>{selected.deviceName}</h2>
                      <button class="rename-button" type="button" disabled={snapshot.operation !== null} onclick={() => startRename(selected)} aria-label={`Rename ${selected.deviceName}`}>Rename</button>
                    </div>
                  {/if}
                  <p>{selected.online ? `Online · updated ${relative(selected.lastSeenAt)}` : `Offline · last seen ${relative(selected.lastSeenAt)}`}</p>
                </div>
              </div>
              <div class="host-version">
                <strong>{selected.metrics.appVersion ? `Nodo ${selected.metrics.appVersion}` : 'Legacy host'}</strong>
                <span>{nodeMode(selected)} node · {isLinuxHost(selected) ? 'Linux host · server telemetry' : selected.metrics.androidSdk ? `Android API ${selected.metrics.androidSdk}` : 'Basic telemetry'}</span>
              </div>
            </header>

            {#if selected.metrics.appVersion === null}
              <div class="upgrade-note"><span>↑</span><p><strong>Extended telemetry is ready.</strong> Install the latest Nodo APK on this device to add battery, memory, network and benchmark data.</p></div>
            {/if}

            <section class="storage-panel" aria-labelledby="storage-heading">
              <div class="storage-ring" style={storageStyle(selected)} title={`Storage health: ${healthLabel(storageScore(selected))}`}>
                <div><strong>{percent(selected.usedBytes, selected.quotaBytes).toFixed(1)}%</strong><span>used</span></div>
              </div>
              <div class="storage-copy">
                <span class="section-label" id="storage-heading">Allocated storage</span>
                <strong>{bytes(selected.usedBytes)} <small>of {bytes(selected.quotaBytes)}</small></strong>
                <div class="storage-track"><i style={`width:${percent(selected.usedBytes, selected.quotaBytes)}%`}></i></div>
                <p>{bytes(selected.quotaBytes - selected.usedBytes)} remains inside the selected limit{selected.metrics.storageAvailableBytes === null ? '' : ` · ${bytes(selected.metrics.storageAvailableBytes)} free on device`}. Partial uploads idle for 24 hours are removed automatically.</p>
              </div>
            </section>

            <section class="telemetry-section" aria-labelledby="telemetry-heading">
              <div class="section-title"><div><span class="section-number">01</span><h3 id="telemetry-heading">Live telemetry</h3></div><span class:online={selected.online} class="live-badge">{selected.online ? 'Live' : 'Offline'}</span></div>
              <div class="metric-grid">
                <article class:metric-loading={telemetryState(selected, 'battery') === 'loading'} class:metric-error={telemetryState(selected, 'battery') === 'error'} aria-busy={telemetryState(selected, 'battery') === 'loading'} data-health={metricHealthLabel(selected, 'battery')} style={healthStyle(metricScore(selected, 'battery'))} title={`Battery: ${metricHealthLabel(selected, 'battery')}`}><div class="metric-content"><span class="metric-icon">↯</span><div><span>Battery</span><strong>{batteryLabel(selected)}</strong></div></div>{#if telemetryState(selected, 'battery') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'battery') === 'error'}<span class="metric-failure" title="Battery could not be refreshed">!</span>{/if}</article>
                <article class:metric-loading={telemetryState(selected, 'memory') === 'loading'} class:metric-error={telemetryState(selected, 'memory') === 'error'} aria-busy={telemetryState(selected, 'memory') === 'loading'} data-health={healthLabel(metricScore(selected, 'memory'))} style={healthStyle(metricScore(selected, 'memory'))} title={`Memory: ${healthLabel(metricScore(selected, 'memory'))}`}><div class="metric-content"><span class="metric-icon">M</span><div><span>Memory</span><strong>{memoryLabel(selected)}</strong></div></div>{#if telemetryState(selected, 'memory') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'memory') === 'error'}<span class="metric-failure" title="Memory could not be refreshed">!</span>{/if}</article>
                <article class:metric-loading={telemetryState(selected, 'connection') === 'loading'} class:metric-error={telemetryState(selected, 'connection') === 'error'} aria-busy={telemetryState(selected, 'connection') === 'loading'} data-health={healthLabel(metricScore(selected, 'connection'))} style={healthStyle(metricScore(selected, 'connection'))} title={`Connection: ${healthLabel(metricScore(selected, 'connection'))}`}><div class="metric-content"><span class="metric-icon">⌁</span><div><span>Connection</span><strong>{networkLabel(selected)}</strong></div></div>{#if telemetryState(selected, 'connection') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'connection') === 'error'}<span class="metric-failure" title="Connection could not be refreshed">!</span>{/if}</article>
                <article class:metric-loading={telemetryState(selected, 'latency') === 'loading'} class:metric-error={telemetryState(selected, 'latency') === 'error'} aria-busy={telemetryState(selected, 'latency') === 'loading'} data-health={healthLabel(metricScore(selected, 'latency'))} style={healthStyle(metricScore(selected, 'latency'))} title={`Latency: ${healthLabel(metricScore(selected, 'latency'))}`}><div class="metric-content"><span class="metric-icon">◷</span><div><span>Latency</span><strong>{latencyLabel(selected)}</strong></div></div>{#if telemetryState(selected, 'latency') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'latency') === 'error'}<span class="metric-failure" title="Latency could not be refreshed">!</span>{/if}</article>
                <article class:metric-loading={telemetryState(selected, 'download') === 'loading'} class:metric-error={telemetryState(selected, 'download') === 'error'} aria-busy={telemetryState(selected, 'download') === 'loading'} data-health={healthLabel(metricScore(selected, 'download'))} style={healthStyle(metricScore(selected, 'download'))} title={`Link download: ${healthLabel(metricScore(selected, 'download'))}`}><div class="metric-content"><span class="metric-icon">⇣</span><div><span>Link download</span><strong>{metricBytes(selected, selected.metrics.networkDownBps, true)}</strong></div></div>{#if telemetryState(selected, 'download') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'download') === 'error'}<span class="metric-failure" title="Download link could not be refreshed">!</span>{/if}</article>
                <article class:metric-loading={telemetryState(selected, 'upload') === 'loading'} class:metric-error={telemetryState(selected, 'upload') === 'error'} aria-busy={telemetryState(selected, 'upload') === 'loading'} data-health={healthLabel(metricScore(selected, 'upload'))} style={healthStyle(metricScore(selected, 'upload'))} title={`Link upload: ${healthLabel(metricScore(selected, 'upload'))}`}><div class="metric-content"><span class="metric-icon">⇡</span><div><span>Link upload</span><strong>{metricBytes(selected, selected.metrics.networkUpBps, true)}</strong></div></div>{#if telemetryState(selected, 'upload') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'upload') === 'error'}<span class="metric-failure" title="Upload link could not be refreshed">!</span>{/if}</article>
                <article class:metric-loading={telemetryState(selected, 'read') === 'loading'} class:metric-error={telemetryState(selected, 'read') === 'error'} aria-busy={telemetryState(selected, 'read') === 'loading'} data-health={healthLabel(metricScore(selected, 'read'))} style={healthStyle(metricScore(selected, 'read'))} title={`Disk read: ${healthLabel(metricScore(selected, 'read'))}`}><div class="metric-content"><span class="metric-icon">↓</span><div><span>Disk read</span><strong>{metricBytes(selected, selected.metrics.diskReadBps, true, 'Run quick test')}</strong></div></div>{#if telemetryState(selected, 'read') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'read') === 'error'}<span class="metric-failure" title="Disk read could not be refreshed">!</span>{/if}</article>
                <article class:metric-loading={telemetryState(selected, 'write') === 'loading'} class:metric-error={telemetryState(selected, 'write') === 'error'} aria-busy={telemetryState(selected, 'write') === 'loading'} data-health={healthLabel(metricScore(selected, 'write'))} style={healthStyle(metricScore(selected, 'write'))} title={`Disk write: ${healthLabel(metricScore(selected, 'write'))}`}><div class="metric-content"><span class="metric-icon">↑</span><div><span>Disk write</span><strong>{metricBytes(selected, selected.metrics.diskWriteBps, true, 'Run quick test')}</strong></div></div>{#if telemetryState(selected, 'write') === 'loading'}<span class="metric-spinner"><LoadingSpinner compact /></span>{:else if telemetryState(selected, 'write') === 'error'}<span class="metric-failure" title="Disk write could not be refreshed">!</span>{/if}</article>
              </div>
              <div class="quick-test-row">
                <div><strong>Fresh device test</strong><span>Refreshes every metric independently and finishes within five seconds.</span></div>
                <button
                  type="button"
                  disabled={!selected.online || snapshot.operation !== null}
                  onclick={() => onQuickTest(selected.id)}
                >
                  {#if snapshot.operation?.nodeId === selected.id && snapshot.operation.type === 'test'}<LoadingSpinner compact /> Testing…{:else}Run test{/if}
                </button>
              </div>
            </section>

            <section class="management-section spaces-section" aria-labelledby="spaces-heading">
              <div class="section-title"><div><span class="section-number">02</span><h3 id="spaces-heading">Public & private spaces</h3></div><span class="secure-badge">One physical Nodo</span></div>
              <div class="space-modes" aria-label="Nodo visibility mode">
                <button class:active={publicDraft(selected) === 0} type="button" onclick={() => selectMode(selected, 'private')}>Private</button>
                <button class:active={publicDraft(selected) > 0 && publicDraft(selected) < selected.quotaBytes} type="button" onclick={() => selectMode(selected, 'mixed')}>Public + Private</button>
                <button class:active={publicDraft(selected) === selected.quotaBytes} type="button" onclick={() => selectMode(selected, 'public')}>Public</button>
              </div>
              <div class="space-cards">
                <article class="private-space">
                  <span class="space-mark">L</span>
                  <div class="space-card-heading"><div><strong>Private</strong><small>Everyone can read; only you can write.</small></div><div class="space-heading-actions"><b>{bytes(selected.quotaBytes - publicDraft(selected))}</b><button class="space-list-button" type="button" aria-label={`List Private data on ${selected.deviceName}`} title="List Private data" onclick={() => onList(selected.id, 'private')}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 5h10M6 10h10M6 15h10"/><path d="M3 5h.01M3 10h.01M3 15h.01"/></svg></button></div></div>
                  <div class="part-track"><i style={`width:${spacePercent(selected.spaces.private.usedBytes, selected.quotaBytes - publicDraft(selected))}%`}></i></div>
                  <p><span>{bytes(selected.spaces.private.usedBytes)} stored</span><span>{spacePercent(selected.spaces.private.usedBytes, selected.quotaBytes - publicDraft(selected)).toFixed(1)}% filled</span></p>
                </article>
                <article class="public-space">
                  <span class="space-mark">P</span>
                  <div class="space-card-heading"><div><strong>Public</strong><small>Everyone can read and authenticated users can write.</small></div><div class="space-heading-actions"><b>{bytes(publicDraft(selected))}</b><button class="space-list-button" type="button" aria-label={`List Public data on ${selected.deviceName}`} title="List Public data" onclick={() => onList(selected.id, 'public')}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 5h10M6 10h10M6 15h10"/><path d="M3 5h.01M3 10h.01M3 15h.01"/></svg></button></div></div>
                  <div class="part-track"><i style={`width:${spacePercent(selected.spaces.public.usedBytes, publicDraft(selected))}%`}></i></div>
                  <p><span>{bytes(selected.spaces.public.usedBytes)} stored</span><span>{spacePercent(selected.spaces.public.usedBytes, publicDraft(selected)).toFixed(1)}% filled</span></p>
                </article>
              </div>
              <input
                aria-label="Public storage allocation"
                class="space-slider"
                type="range"
                min="0"
                max={selected.quotaBytes}
                step="any"
                value={publicDraft(selected)}
                oninput={(event) => setPublicDraft(selected, Number(event.currentTarget.value))}
              />
              <div class="space-usage"><span>100% Private</span><strong>{nodeMode(selected, publicDraft(selected))}</strong><span>100% Public</span></div>
              <div class="space-save">
                <p>{supportsSpaces(selected) ? allocationNotice(selected) : 'Install Nodo 0.1.0 or newer on this host to enable separate spaces.'}</p>
                <button
                  type="button"
                  disabled={!supportsSpaces(selected) || snapshot.operation !== null || publicDraft(selected) === selected.spaces.public.quotaBytes}
                  onclick={() => saveSpaces(selected)}
                >
                  {#if snapshot.operation?.nodeId === selected.id && snapshot.operation.type === 'spaces'}<LoadingSpinner compact /> Saving…{:else}Apply split{/if}
                </button>
              </div>
            </section>

            <section class="management-section" aria-labelledby="policy-heading">
              <div class="section-title"><div><span class="section-number">03</span><h3 id="policy-heading">Access & policies</h3></div><span class="secure-badge">Encrypted identity</span></div>
              <div class="policy-list">
                <div class="policy-row"><div><strong>Authenticated access</strong><span>Every request requires a short-lived account ticket.</span></div><button aria-label="Authenticated access" class="switch on locked" type="button" role="switch" aria-checked="true" disabled><i></i></button></div>
                <div class="policy-row"><div><strong>Allow uploads</strong><span>Clients can store new data on this node.</span></div><button aria-label="Allow uploads" class:on={selected.policy.allowUploads} class="switch" type="button" role="switch" aria-checked={selected.policy.allowUploads} disabled={snapshot.operation !== null} onclick={() => toggle(selected, 'allowUploads')}><i></i></button></div>
                <div class="policy-row"><div><strong>Allow downloads</strong><span>Clients can retrieve completed files.</span></div><button aria-label="Allow downloads" class:on={selected.policy.allowDownloads} class="switch" type="button" role="switch" aria-checked={selected.policy.allowDownloads} disabled={snapshot.operation !== null} onclick={() => toggle(selected, 'allowDownloads')}><i></i></button></div>
                <div class="policy-row"><div><strong>Wi-Fi only</strong><span>Pause transfers while the host is on cellular data.</span></div><button aria-label="Wi-Fi only" class:on={selected.policy.wifiOnly} class="switch" type="button" role="switch" aria-checked={selected.policy.wifiOnly} disabled={snapshot.operation !== null} onclick={() => toggle(selected, 'wifiOnly')}><i></i></button></div>
                {#if isBatterylessHost(selected)}
                  <div class="policy-row"><div><strong>Charging condition</strong><span>This batteryless Linux host always uses external power.</span></div><span class="policy-unavailable">Not applicable</span></div>
                {:else}
                  <div class="policy-row"><div><strong>Charging only</strong><span>Pause transfers while the device is on battery.</span></div><button aria-label="Charging only" class:on={selected.policy.chargingOnly} class="switch" type="button" role="switch" aria-checked={selected.policy.chargingOnly} disabled={snapshot.operation !== null} onclick={() => toggle(selected, 'chargingOnly')}><i></i></button></div>
                {/if}
              </div>
            </section>

            <section class="connection-section" aria-labelledby="connection-heading">
              <div class="section-title"><div><span class="section-number">04</span><h3 id="connection-heading">Connection</h3></div><span>{selected.protocol}</span></div>
              <div class="connection-grid">
                <article><span>Local address</span><strong>{selected.localAddresses[0] ?? 'Not announced'}</strong><small>Port {selected.port}</small></article>
                <article><span>Observed public address</span><strong>{selected.observedAddress ?? 'Unavailable'}</strong><small>Coordinator rendezvous</small></article>
                <article><span>Node ID</span><strong>{selected.id.slice(0, 13)}…</strong><small>Created {relative(selected.createdAt)}</small></article>
              </div>
              <p class="connection-note"><span>i</span> Direct LAN routes are preferred. Public transfer remains disabled until a secure relay or end-to-end tunnel is available.</p>
            </section>

            <section class="danger-section">
              {#if confirmingPrivateClear}
                <div><strong>Delete the Private space?</strong><span>Only private posts, media and uploads will be permanently removed. Public content will remain untouched.</span></div>
                <div class="danger-actions"><button type="button" onclick={() => confirmingPrivateClear = false}>Cancel</button><button class="confirm" type="button" disabled={snapshot.operation !== null} onclick={() => clearPrivateSelected(selected)}>Delete Private</button></div>
              {:else}
                <div><strong>Delete Private content</strong><span>Free only the storage used by the Private part of this Nodo.</span></div>
                <button type="button" disabled={!selected.online || selected.spaces.private.usedBytes === 0 || snapshot.operation !== null} onclick={() => confirmingPrivateClear = true}>
                  {#if snapshot.operation?.nodeId === selected.id && snapshot.operation.type === 'clear-private'}<LoadingSpinner compact /> Deleting…{:else}Delete Private…{/if}
                </button>
              {/if}
            </section>

            <section class="danger-section">
              {#if confirmingClear}
                <div><strong>Delete everything on this Nodo?</strong><span>All posts, media and partial uploads will be permanently removed. The host stays connected.</span></div>
                <div class="danger-actions"><button type="button" onclick={() => confirmingClear = false}>Cancel</button><button class="confirm" type="button" disabled={snapshot.operation !== null} onclick={() => clearSelected(selected)}>Delete everything</button></div>
              {:else}
                <div><strong>Delete all content</strong><span>Immediately free all storage used by this Nodo without removing the host.</span></div>
                <button type="button" disabled={!selected.online || snapshot.operation !== null} onclick={() => confirmingClear = true}>
                  {#if snapshot.operation?.nodeId === selected.id && snapshot.operation.type === 'clear'}<LoadingSpinner compact /> Deleting…{:else}Delete content…{/if}
                </button>
              {/if}
            </section>

            <section class="danger-section">
              {#if confirmingDelete}
                <div><strong>Remove this node?</strong><span>The Android host keeps its local files, but it will need to register again.</span></div>
                <div class="danger-actions"><button type="button" onclick={() => confirmingDelete = false}>Cancel</button><button class="confirm" type="button" disabled={snapshot.operation !== null} onclick={() => removeSelected(selected)}>Remove node</button></div>
              {:else}
                <div><strong>Remove from Kaordo</strong><span>Disconnect this host from your account.</span></div>
                <button type="button" onclick={() => confirmingDelete = true}>Remove…</button>
              {/if}
            </section>
          </section>
        {/if}
      </div>
    {/if}
  </div>
</main>

<style>
  .nodo-shell { min-width: 0; min-height: 0; overflow: auto; color: #26342d; background: radial-gradient(circle at 72% 0%, rgb(65 139 113 / 11%), transparent 32%), #f3f6f2; }
  .nodo-layout { width: min(100%, 1120px); margin: 0 auto; padding: 31px 34px 64px; }
  .nodo-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 23px; padding: 0 2px; }
  .eyebrow { color: #4d826e; font-size: calc(9px * var(--text-scale)); font-weight: 760; letter-spacing: .15em; text-transform: uppercase; }
  h1 { margin-top: 5px; color: #1f2d27; font-size: calc(29px * var(--text-scale)); line-height: 1; letter-spacing: -.045em; }
  .nodo-heading p { margin-top: 8px; color: #768078; font-size: calc(11px * var(--text-scale)); }
  button { font: inherit; }
  .refresh-button, .empty-card button { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px; color: #345c4e; background: #fff; border: 1px solid #d5ded8; border-radius: 9px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 680; box-shadow: 0 2px 7px rgb(39 65 54 / 5%); }
  .refresh-button:disabled { cursor: wait; opacity: .68; }
  .inline-error { margin-bottom: 12px; padding: 10px 12px; color: #8d493f; background: #faeeeb; border: 1px solid #efd6d1; border-radius: 9px; font-size: calc(9px * var(--text-scale)); }
  .fleet-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 13px; }
  .fleet-summary article { padding: 13px 14px; background: rgb(255 255 255 / 82%); border: 1px solid #dce4de; border-radius: 11px; box-shadow: 0 6px 20px rgb(41 70 57 / 4%); }
  .fleet-summary span, .fleet-summary strong, .fleet-summary small { display: block; }
  .fleet-summary span { color: #7f8b84; font-size: calc(8px * var(--text-scale)); }
  .fleet-summary strong { margin-top: 4px; color: #24362d; font-size: calc(17px * var(--text-scale)); letter-spacing: -.025em; }
  .fleet-summary small { margin-top: 2px; color: #9aa39d; font-size: calc(7px * var(--text-scale)); }
  .fleet-summary .privacy-stat strong { color: #377a62; font-size: calc(13px * var(--text-scale)); }
  .nodo-grid { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 13px; align-items: start; }
  .node-list, .node-detail { background: rgb(255 255 255 / 84%); border: 1px solid #dbe3dd; border-radius: 15px; box-shadow: 0 12px 32px rgb(45 72 61 / 6%); }
  .node-list { position: sticky; top: 16px; overflow: hidden; padding: 10px; }
  .node-list > header { display: flex; align-items: center; justify-content: space-between; padding: 5px 6px 10px; color: #55645c; font-size: calc(9px * var(--text-scale)); font-weight: 730; }
  .node-list > header small { color: #89948d; font-size: calc(7px * var(--text-scale)); font-weight: 550; }
  .node-item { display: flex; align-items: center; width: 100%; gap: 10px; min-height: 57px; padding: 9px; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 10px; cursor: pointer; text-align: left; }
  .node-item:hover { background: #f5f8f5; }
  .node-item.active { background: #eaf3ee; border-color: #cfe0d6; }
  .node-icon { position: relative; width: 31px; height: 31px; flex: none; background: linear-gradient(145deg, #edf1ee, #dfe6e1); border-radius: 9px; }
  .node-icon::before, .node-icon::after { position: absolute; content: ''; left: 8px; width: 15px; height: 2px; background: #7b8a82; border-radius: 2px; }
  .node-icon::before { top: 10px; } .node-icon::after { top: 16px; }
  .node-icon i { position: absolute; right: 5px; bottom: 5px; width: 6px; height: 6px; background: #aeb8b2; border: 2px solid #edf1ee; border-radius: 50%; }
  .node-icon.online i { background: #45a476; box-shadow: 0 0 0 2px rgb(69 164 118 / 12%); }
  .node-copy { min-width: 0; flex: 1; }
  .node-copy strong, .node-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-copy strong { color: #2d3d35; font-size: calc(9px * var(--text-scale)); }
  .node-copy small { margin-top: 3px; color: #8a958e; font-size: calc(7px * var(--text-scale)); }
  .node-space { color: #728078; font-size: calc(7px * var(--text-scale)); font-weight: 680; }
  .list-note { padding: 10px 7px 4px; color: #9ba49f; border-top: 1px solid #edf0ed; font-size: calc(7px * var(--text-scale)); line-height: 1.5; }
  .node-detail { padding: 20px; }
  .device-header, .device-title, .storage-panel, .section-title, .quick-test-row, .policy-row, .danger-section { display: flex; align-items: center; }
  .device-header { justify-content: space-between; gap: 18px; padding: 1px 2px 17px; border-bottom: 1px solid #e5eae6; }
  .device-title { gap: 11px; }
  .status-dot { width: 10px; height: 10px; flex: none; background: #b6beb9; border-radius: 50%; }
  .status-dot.online { background: #4aa77a; box-shadow: 0 0 0 5px rgb(74 167 122 / 11%); }
  .device-title h2 { color: #22332a; font-size: calc(17px * var(--text-scale)); letter-spacing: -.025em; }
  .name-row { display: flex; align-items: center; gap: 8px; }
  .rename-button { padding: 3px 6px; color: #56806e; background: transparent; border: 1px solid #d3e2d9; border-radius: 5px; cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 680; }
  .rename-button:disabled { cursor: default; opacity: .55; }
  .rename-form { display: flex; align-items: center; gap: 5px; }
  .rename-form input { width: min(230px, 40vw); height: 27px; padding: 0 7px; color: #26382e; background: #fff; border: 1px solid #9fc4af; border-radius: 6px; font: inherit; font-size: calc(12px * var(--text-scale)); outline: 0; }
  .rename-form input:focus { box-shadow: 0 0 0 3px rgb(72 145 111 / 13%); }
  .rename-form button { height: 27px; padding: 0 7px; color: #fff; background: #467f66; border: 0; border-radius: 6px; cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 680; }
  .rename-form button:disabled { cursor: default; opacity: .5; }
  .rename-form .rename-cancel { color: #61736a; background: #eef3ef; border: 1px solid #dce5df; }
  .device-title p, .host-version span { margin-top: 3px; color: #88938c; font-size: calc(8px * var(--text-scale)); }
  .host-version { text-align: right; }
  .host-version strong, .host-version span { display: block; }
  .host-version strong { color: #52655a; font-size: calc(8px * var(--text-scale)); }
  .upgrade-note { display: flex; align-items: center; gap: 10px; margin-top: 13px; padding: 10px 12px; color: #66776e; background: #eef5f1; border: 1px solid #d6e5dc; border-radius: 10px; font-size: calc(8px * var(--text-scale)); line-height: 1.45; }
  .upgrade-note > span { display: grid; width: 23px; height: 23px; flex: none; color: #3f8067; background: #fff; border-radius: 7px; place-items: center; }
  .upgrade-note strong { color: #365b4b; }
  .storage-panel { gap: 19px; margin-top: 14px; padding: 17px; color: #eff8f3; background: linear-gradient(135deg, #20372e, #2b4b3e); border-radius: 13px; }
  .storage-ring { display: grid; width: 76px; height: 76px; flex: none; background: conic-gradient(var(--storage-accent) var(--used), rgb(255 255 255 / 10%) 0); border-radius: 50%; place-items: center; transition: background 220ms ease; }
  .storage-ring::before { grid-area: 1/1; width: 61px; height: 61px; background: #294238; border-radius: 50%; content: ''; }
  .storage-ring div { z-index: 1; grid-area: 1/1; text-align: center; }
  .storage-ring strong, .storage-ring span { display: block; }
  .storage-ring strong { font-size: calc(13px * var(--text-scale)); } .storage-ring span { margin-top: 1px; color: #9fc8b7; font-size: calc(7px * var(--text-scale)); text-transform: uppercase; }
  .storage-copy { min-width: 0; flex: 1; }
  .section-label { color: #9ec0b2; font-size: calc(7px * var(--text-scale)); font-weight: 720; letter-spacing: .1em; text-transform: uppercase; }
  .storage-copy > strong { display: block; margin-top: 4px; font-size: calc(19px * var(--text-scale)); letter-spacing: -.03em; }
  .storage-copy > strong small { color: #a7bdb4; font-size: calc(10px * var(--text-scale)); font-weight: 520; }
  .storage-track { height: 5px; margin-top: 9px; overflow: hidden; background: rgb(255 255 255 / 10%); border-radius: 99px; }
  .storage-track i { display: block; min-width: 2px; height: 100%; background: var(--storage-accent); border-radius: inherit; transition: background 220ms ease; }
  .storage-copy p { margin-top: 7px; color: rgb(235 247 240 / 55%); font-size: calc(7px * var(--text-scale)); }
  .telemetry-section, .management-section, .connection-section { margin-top: 14px; padding: 16px; background: #fafcfa; border: 1px solid #e0e7e2; border-radius: 12px; }
  .section-title { justify-content: space-between; margin-bottom: 13px; }
  .section-title > div { display: flex; align-items: center; gap: 8px; }
  .section-title h3 { color: #2d3c34; font-size: calc(11px * var(--text-scale)); }
  .section-number { color: #76a38f; font-family: ui-monospace, monospace; font-size: calc(8px * var(--text-scale)); }
  .live-badge, .secure-badge, .section-title > span { padding: 4px 7px; color: #7d8982; background: #f0f3f1; border: 1px solid #e0e5e1; border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-weight: 680; }
  .live-badge.online { color: #39775f; background: #e7f3ed; border-color: #cee4d8; }
  .secure-badge { color: #4f7666; }
  .space-modes { display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 3px; margin-bottom: 10px; padding: 3px; background: #edf1ee; border: 1px solid #e0e6e1; border-radius: 9px; }
  .space-modes button { height: 29px; color: #78847d; background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .space-modes button.active { color: #365e4e; background: #fff; box-shadow: 0 1px 5px rgb(37 62 50 / 11%); }
  .space-cards { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .space-cards::after { position: absolute; top: 10px; bottom: 10px; left: 50%; width: 1px; background: #dfe5e0; content: ''; transform: translateX(-50%); }
  .space-cards article { display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 9px; min-width: 0; padding: 12px; border: 1px solid; border-radius: 10px; }
  .space-cards .public-space { background: #eef8f2; border-color: #cfe5d6; }
  .space-cards .private-space { background: #f4f1fa; border-color: #ddd6ec; }
  .space-mark { display: grid; width: 29px; height: 29px; color: #fff; background: #4c9674; border-radius: 8px; font-size: calc(9px * var(--text-scale)); font-weight: 780; place-items: center; }
  .private-space .space-mark { background: #756991; }
  .space-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
  .space-card-heading > div { min-width: 0; }
  .space-heading-actions { display: inline-flex; align-items: center; gap: 5px; }
  .space-cards strong, .space-cards small { display: block; }
  .space-cards strong { color: #35483e; font-size: calc(8px * var(--text-scale)); }
  .space-cards small { margin-top: 2px; color: #829087; font-size: calc(7px * var(--text-scale)); line-height: 1.35; }
  .space-cards b { color: #3d5147; font-size: calc(9px * var(--text-scale)); white-space: nowrap; }
  .space-list-button { display: grid; width: 24px; height: 24px; padding: 0; color: #4b806d; background: rgb(255 255 255 / 70%); border: 1px solid #c7ded0; border-radius: 6px; cursor: pointer; place-items: center; }
  .space-list-button:hover { color: #2d6652; background: #fff; border-color: #9fc5ae; }
  .space-list-button svg { width: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .part-track { grid-column: 1 / -1; height: 5px; overflow: hidden; background: rgb(63 83 72 / 10%); border-radius: 99px; }
  .part-track i { display: block; height: 100%; background: #756991; border-radius: inherit; transition: width 180ms ease; }
  .public-space .part-track i { background: #4d9877; }
  .space-cards article > p { display: flex; grid-column: 1 / -1; justify-content: space-between; gap: 8px; color: #77877e; font-size: calc(7px * var(--text-scale)); }
  .space-slider { width: 100%; margin: 16px 0 5px; accent-color: #4d9877; cursor: ew-resize; }
  .space-usage { display: flex; align-items: center; justify-content: space-between; color: #8b9790; font-size: calc(7px * var(--text-scale)); }
  .space-usage strong { color: #4a695b; font-size: calc(8px * var(--text-scale)); }
  .space-save { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; padding-top: 11px; border-top: 1px solid #e7ebe8; }
  .space-save p { max-width: 450px; color: #87928c; font-size: calc(7px * var(--text-scale)); line-height: 1.45; }
  .space-save button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 82px; height: 29px; padding: 0 10px; color: #fff; background: #467f66; border: 0; border-radius: 7px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .space-save button:disabled { cursor: default; opacity: .5; }
  .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .metric-grid article { position: relative; min-width: 0; overflow: hidden; padding: 10px; background: var(--health-bg); border: 1px solid var(--health-border); border-radius: 9px; transition: background 220ms ease, border-color 220ms ease; }
  .metric-grid article::after { position: absolute; inset: 0 0 auto; height: 2px; background: var(--health-accent); content: ''; opacity: .48; }
  .metric-content { display: flex; align-items: center; gap: 9px; min-width: 0; transition: filter 160ms ease, opacity 160ms ease; }
  .metric-content > div { min-width: 0; }
  .metric-loading .metric-content { filter: blur(3px); opacity: .38; }
  .metric-spinner, .metric-failure { position: absolute; z-index: 2; inset: 50% auto auto 50%; display: grid; width: 22px; height: 22px; color: #3e7d64; background: rgb(255 255 255 / 88%); border: 1px solid rgb(117 158 140 / 35%); border-radius: 50%; box-shadow: 0 4px 12px rgb(41 67 55 / 12%); place-items: center; transform: translate(-50%, -50%); }
  .metric-failure { color: #9d4c44; background: #fff7f5; border-color: #e6bbb5; font-size: calc(8px * var(--text-scale)); font-weight: 800; }
  .metric-error { --health-bg: #fff8f6 !important; --health-border: #edcbc5 !important; --health-accent: #b86659 !important; }
  .metric-icon { display: grid; width: 26px; height: 26px; flex: none; color: var(--health-accent); background: var(--health-icon); border-radius: 7px; font-size: calc(9px * var(--text-scale)); font-weight: 760; place-items: center; transition: color 220ms ease, background 220ms ease; }
  .metric-content span:not(.metric-icon), .metric-content strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .metric-content span:not(.metric-icon) { color: #929c96; font-size: calc(7px * var(--text-scale)); }
  .metric-grid article strong { margin-top: 3px; color: #394b41; font-size: calc(8px * var(--text-scale)); }
  .quick-test-row { justify-content: space-between; gap: 15px; margin-top: 10px; padding-top: 11px; border-top: 1px solid #e7ebe8; }
  .quick-test-row strong, .quick-test-row span { display: block; }
  .quick-test-row strong { color: #405047; font-size: calc(8px * var(--text-scale)); }
  .quick-test-row span { margin-top: 2px; color: #929c96; font-size: calc(7px * var(--text-scale)); }
  .quick-test-row button { display: inline-flex; align-items: center; gap: 5px; min-width: 76px; height: 28px; justify-content: center; color: #35634f; background: #eaf3ee; border: 1px solid #cfe1d7; border-radius: 7px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .quick-test-row button:disabled { cursor: default; opacity: .6; }
  .policy-list { overflow: hidden; border: 1px solid #e4e9e5; border-radius: 9px; }
  .policy-row { justify-content: space-between; gap: 18px; min-height: 51px; padding: 9px 11px; background: #fff; border-top: 1px solid #e9edea; }
  .policy-row:first-child { border-top: 0; }
  .policy-row strong, .policy-row span { display: block; }
  .policy-row strong { color: #3c4d43; font-size: calc(8px * var(--text-scale)); }
  .policy-row span { margin-top: 2px; color: #929c96; font-size: calc(7px * var(--text-scale)); }
  .policy-row .policy-unavailable { flex: none; margin: 0; padding: 4px 7px; color: #738078; background: #f0f3f1; border: 1px solid #dfe5e1; border-radius: 999px; font-weight: 680; }
  .switch { position: relative; width: 29px; height: 17px; flex: none; padding: 0; background: #d8ded9; border: 0; border-radius: 99px; cursor: pointer; transition: background 150ms ease; }
  .switch i { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; background: #fff; border-radius: 50%; box-shadow: 0 1px 3px rgb(30 48 39 / 18%); transition: transform 150ms ease; }
  .switch.on { background: #4f9b7c; } .switch.on i { transform: translateX(12px); }
  .switch:disabled { cursor: wait; opacity: .6; } .switch.locked:disabled { cursor: default; opacity: .82; }
  .connection-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .connection-grid article { min-width: 0; padding: 10px; background: #fff; border: 1px solid #e5eae6; border-radius: 9px; }
  .connection-grid span, .connection-grid strong, .connection-grid small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .connection-grid span { color: #949e98; font-size: calc(7px * var(--text-scale)); }
  .connection-grid strong { margin-top: 4px; color: #3b4b42; font-family: ui-monospace, monospace; font-size: calc(8px * var(--text-scale)); }
  .connection-grid small { margin-top: 3px; color: #a0a8a3; font-size: calc(7px * var(--text-scale)); }
  .connection-note { display: flex; align-items: center; gap: 7px; margin-top: 10px; color: #89948d; font-size: calc(7px * var(--text-scale)); line-height: 1.4; }
  .connection-note span { display: grid; width: 15px; height: 15px; flex: none; color: #5f8374; background: #eaf1ed; border-radius: 50%; place-items: center; }
  .danger-section { justify-content: space-between; gap: 16px; margin-top: 14px; padding: 13px 15px; background: #fffafa; border: 1px solid #eadedb; border-radius: 11px; }
  .danger-section strong, .danger-section span { display: block; }
  .danger-section strong { color: #68433c; font-size: calc(8px * var(--text-scale)); }
  .danger-section span { margin-top: 3px; color: #9d8984; font-size: calc(7px * var(--text-scale)); }
  .danger-section button { height: 28px; padding: 0 9px; color: #8a5148; background: #fff; border: 1px solid #e4cbc6; border-radius: 7px; cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 680; }
  .danger-actions { display: flex; gap: 6px; } .danger-actions .confirm { color: #fff; background: #a25b50; border-color: #a25b50; }
  .loading-card, .empty-card { display: grid; min-height: 310px; padding: 38px; background: rgb(255 255 255 / 82%); border: 1px solid #dce3de; border-radius: 16px; place-items: center; align-content: center; gap: 10px; color: #718078; text-align: center; }
  .loading-card { font-size: calc(9px * var(--text-scale)); }
  .empty-card h2 { color: #28382f; font-size: calc(18px * var(--text-scale)); }
  .empty-card p { max-width: 420px; color: #7a867f; font-size: calc(9px * var(--text-scale)); line-height: 1.55; }
  .empty-mark { position: relative; width: 55px; height: 48px; margin-bottom: 7px; }
  .empty-mark i { position: absolute; width: 28px; height: 28px; background: #e7f0eb; border: 1px solid #c9ddd2; border-radius: 9px; }
  .empty-mark i:nth-child(1) { left: 0; top: 10px; } .empty-mark i:nth-child(2) { left: 14px; top: 0; } .empty-mark i:nth-child(3) { right: 0; bottom: 0; }
  @media (max-width: 900px) { .fleet-summary { grid-template-columns: 1fr 1fr; } .nodo-grid { grid-template-columns: 190px minmax(0, 1fr); } .metric-grid, .space-cards { grid-template-columns: 1fr; } .space-cards::after { display: none; } .connection-grid { grid-template-columns: 1fr; } }
</style>
