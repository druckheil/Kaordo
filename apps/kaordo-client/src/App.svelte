<script lang="ts">
  import { flushSync, onDestroy, onMount, tick, untrack } from 'svelte';
  import AppHeader from './components/AppHeader.svelte';
  import AuthScreen from './components/auth/AuthScreen.svelte';
  import CreateObjectDialog from './components/CreateObjectDialog.svelte';
  import CreateWorkspaceDialog from './components/CreateWorkspaceDialog.svelte';
  import EditorPanel from './components/EditorPanel.svelte';
  import FilesPanel from './components/FilesPanel.svelte';
  import ObjectsPanel from './components/ObjectsPanel.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import FloatingDragCard from './components/canvas/FloatingDragCard.svelte';
  import FluoFeed from './components/fluo/FluoFeed.svelte';
  import ProfileSection from './components/sections/ProfileSection.svelte';
  import RegadoSection from './components/regado/RegadoSection.svelte';
  import NodoSection from './components/nodo/NodoSection.svelte';
  import RondoSection from './components/rondo/RondoSection.svelte';
  import LigoSection from './components/ligo/LigoSection.svelte';
  import SettingsSection from './components/settings/SettingsSection.svelte';
  import ContextMenu from './components/ui/ContextMenu.svelte';
  import { EditorController } from './lib/EditorController';
  import { AuthController } from './lib/AuthController';
  import { RegadoController } from './lib/RegadoController';
  import { NodoController } from './lib/NodoController';
  import { AppearanceController } from './lib/AppearanceController';
  import { MediaSettingsController } from './lib/MediaSettingsController';
  import { RondoController } from './lib/RondoController';
  import { LigoController } from './lib/LigoController';
  import type { AppScale, AppTheme, TextScale } from './lib/domain/appearance';
  import type { AuthMode } from './lib/domain/auth';
  import {
    appSectionLabel,
    appSectionsFor,
    type AppSection,
  } from './lib/domain/appSection';
  import type {
    WorkspaceDetail,
    WorkspaceSummary,
  } from './lib/domain/workspace';
  import { workspaceSummary } from './lib/domain/workspace';
  import type { AuthGateway } from './lib/gateways/AuthGateway';
  import type { AdminGateway } from './lib/gateways/AdminGateway';
  import type { AppearanceGateway } from './lib/gateways/AppearanceGateway';
  import type { MediaSettingsGateway } from './lib/gateways/MediaSettingsGateway';
  import { WebMediaSettingsGateway } from './lib/gateways/WebMediaSettingsGateway';
  import type { WorkspaceGateway } from './lib/gateways/WorkspaceGateway';
  import type { NodoGateway } from './lib/gateways/NodoGateway';
  import type { FluoGateway } from './lib/gateways/FluoGateway';
  import type { RondoGateway } from './lib/gateways/RondoGateway';
  import type { LigoGateway } from './lib/gateways/LigoGateway';
  import { NodeFluoGateway } from './lib/gateways/NodeFluoGateway';
  import { NodoRegistry } from './lib/services/NodoRegistry';
  import { closeContextMenu } from './lib/ui/contextMenu';

  const EMPTY_NODO_GATEWAY: NodoGateway = {
    accessNode: async () => { throw new Error('Nodo access is unavailable.'); },
    cancelPublicStorage: async () => {},
    clearStorage: async () => { throw new Error('Nodo storage is unavailable.'); },
    clearPrivateStorage: async () => { throw new Error('Private Nodo storage is unavailable.'); },
    commitPublicStorage: async () => {},
    deleteNode: async () => {},
    listNodes: async () => [],
    listFeedNodeIds: async () => [],
    publicStorage: async () => ({
      limitBytes: 1_073_741_824,
      nodeCandidates: [],
      reservedBytes: 0,
      usedBytes: 0,
    }),
    releasePublicPost: async () => {},
    renewPublicStorage: async () => { throw new Error('Public Nodo storage is unavailable.'); },
    reservePublicStorage: async () => { throw new Error('Public Nodo storage is unavailable.'); },
    requestQuickTest: async () => ({ completedAt: 0, diskReadBps: 1, diskWriteBps: 1 }),
    updatePolicy: async (_nodeId, policy) => ({ ...policy, ownerOnly: true }),
    updateSpaces: async () => { throw new Error('Nodo allocation is unavailable.'); },
  };

  const EMPTY_RONDO_GATEWAY: RondoGateway = {
    addNode: async () => { throw new Error('Rondo service is unavailable.'); },
    bootstrap: async () => ({
      privateNodes: [],
      publicOption: { alreadyCreated: false, available: false, limitBytes: 1_073_741_824 },
      spaces: [],
    }),
    createInvite: async () => { throw new Error('Rondo service is unavailable.'); },
    createRoom: async () => { throw new Error('Rondo service is unavailable.'); },
    createSpace: async () => { throw new Error('Rondo service is unavailable.'); },
    deleteRoom: async () => { throw new Error('Rondo service is unavailable.'); },
    joinSpace: async () => { throw new Error('Rondo service is unavailable.'); },
    loadSpace: async () => { throw new Error('Rondo service is unavailable.'); },
    messageRoute: async () => { throw new Error('Rondo message routing is unavailable.'); },
    removeNode: async () => { throw new Error('Rondo service is unavailable.'); },
    reorderNodes: async () => { throw new Error('Rondo service is unavailable.'); },
    revokeInvite: async () => { throw new Error('Rondo service is unavailable.'); },
    updateSpace: async () => { throw new Error('Rondo service is unavailable.'); },
    voiceIce: async () => ({
      expiresAt: 0,
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    }),
  };

  const EMPTY_LIGO_GATEWAY: LigoGateway = {
    acknowledge: async () => {},
    bootstrap: async () => ({ conversations: [], nextCursor: null }),
    createDelivery: async () => { throw new Error('Ligo service is unavailable.'); },
    inbox: async () => ({ deliveries: [], nextCursor: null }),
    searchUsers: async () => [],
  };

  type AppProps = {
    autoloadWorkspaceLibrary?: boolean;
    adminGateway: AdminGateway;
    appearanceGateway: AppearanceGateway;
    authGateway: AuthGateway;
    files?: WorkspaceSummary[];
    fluoGateway?: FluoGateway;
    initialAuthUser?: import('./lib/domain/auth').AuthUser | null;
    ligoGateway?: LigoGateway;
    mediaSettingsGateway?: MediaSettingsGateway;
    nodoGateway?: NodoGateway;
    rondoGateway?: RondoGateway;
    workspace?: WorkspaceDetail | null;
    workspaceGateway: WorkspaceGateway;
  };

  type FocusableHeader = { focusBack(): void };
  type FocusableFiles = { focusRetry(): void; focusTitle(): void };
  type FocusableEditor = { focusCreateWorkspace(): void; focusRetry(): void };
  type FocusableObjects = { focusNewObject(): void };

  let {
    autoloadWorkspaceLibrary = true,
    adminGateway,
    appearanceGateway,
    authGateway,
    files = [],
    fluoGateway = undefined,
    initialAuthUser = null,
    ligoGateway = EMPTY_LIGO_GATEWAY,
    mediaSettingsGateway = new WebMediaSettingsGateway(),
    nodoGateway = EMPTY_NODO_GATEWAY,
    rondoGateway = EMPTY_RONDO_GATEWAY,
    workspace = null,
    workspaceGateway,
  }: AppProps = $props();

  const auth = untrack(() => new AuthController(authGateway, initialAuthUser));
  const regado = untrack(() => new RegadoController(adminGateway));
  const nodoRegistry = untrack(() => new NodoRegistry());
  const nodo = untrack(() => new NodoController(nodoGateway, nodoRegistry));
  const appearance = untrack(() => new AppearanceController(appearanceGateway));
  const mediaSettings = untrack(() => new MediaSettingsController(mediaSettingsGateway));
  const rondo = untrack(() => new RondoController(rondoGateway, nodoGateway, mediaSettings.state.snapshot));
  const ligo = untrack(() => new LigoController(ligoGateway, nodoGateway));
  const effectiveFluoGateway = untrack(() => fluoGateway ?? new NodeFluoGateway(nodoGateway));
  // App construction is intentionally one-shot. Runtime changes flow through
  // the state managers instead of rebuilding the composition root.
  const editor = untrack(
    () =>
      new EditorController(workspaceGateway, {
        autoloadWorkspaceLibrary,
        files,
        fluoGateway: effectiveFluoGateway,
        nodoGateway,
        nodoRegistry,
        workspace,
      }),
  );
  const platform = untrack(() => workspaceGateway.platform);
  const storageLocation =
    platform === 'desktop' ? 'Documents/Kaordo' : 'Browser storage';
  let workspaceSnapshot = $state(editor.workspaceState.snapshot);
  let canvasSnapshot = $state(editor.canvasState.snapshot);
  let fluoSnapshot = $state(editor.fluoState.snapshot);
  let authSnapshot = $state(auth.state.snapshot);
  let regadoSnapshot = $state(regado.state.snapshot);
  let nodoSnapshot = $state(nodo.state.snapshot);
  let appearanceSnapshot = $state(appearance.state.snapshot);
  let mediaSettingsSnapshot = $state(mediaSettings.state.snapshot);
  let rondoSnapshot = $state(rondo.state.snapshot);
  let ligoSnapshot = $state(ligo.state.snapshot);
  let activeSection = $state<AppSection>('klaro');
  let isCreateWorkspaceOpen = $state(false);
  let isCreateObjectOpen = $state(false);
  let isLoggingOut = $state(false);
  let header = $state<FocusableHeader>();
  let filesPanel = $state<FocusableFiles>();
  let editorPanel = $state<FocusableEditor>();
  let objectsPanel = $state<FocusableObjects>();
  let activeFile = $derived(
    workspaceSnapshot.active
      ? workspaceSummary(workspaceSnapshot.active)
      : workspaceSnapshot.opening,
  );
  let showCreateWorkspace = $derived(
    activeSection === 'klaro' &&
      isCreateWorkspaceOpen &&
      workspaceSnapshot.active === null,
  );

  async function clearNodoStorage(nodeId: string): Promise<boolean> {
    const cleared = await nodo.state.clearStorage(nodeId);
    if (cleared) editor.fluoState.clearNodeContent(nodeId);
    return cleared;
  }
  async function clearPrivateNodoStorage(nodeId: string): Promise<boolean> {
    const cleared = await nodo.state.clearPrivateStorage(nodeId);
    if (cleared) editor.fluoState.clearNodeContent(nodeId, 'private');
    return cleared;
  }
  let isModalOpen = $derived(showCreateWorkspace || isCreateObjectOpen);

  const unsubscribeAuth = auth.manager.subscribe((snapshot) => {
    if (!snapshot) return;
    authSnapshot = snapshot;
    if (snapshot.phase === 'authenticated') {
      editor.start();
      if (activeSection === 'fluo') editor.startFluo();
      if (activeSection === 'rondo') rondo.start();
      ligo.state.configure(snapshot.user?.id ?? null);
      if (activeSection === 'ligo') ligo.start();
      if (snapshot.user?.role === 'user' && activeSection === 'regado') {
        activeSection = 'klaro';
        regado.stop();
      }
    } else {
      editor.stop();
      regado.stop();
      nodo.stop();
      nodo.state.reset();
      rondo.stop();
      rondo.state.reset();
      ligo.stop();
      ligo.state.configure(null);
    }
  });
  const unsubscribeWorkspace = editor.workspaceManager.subscribe((snapshot) => {
    if (snapshot) workspaceSnapshot = snapshot;
  });
  const unsubscribeCanvas = editor.canvasManager.subscribe((snapshot) => {
    if (snapshot) canvasSnapshot = snapshot;
  });
  const unsubscribeFluo = editor.fluoManager.subscribe((snapshot) => {
    if (snapshot) fluoSnapshot = snapshot;
  });
  const unsubscribeRegado = regado.manager.subscribe((snapshot) => {
    if (snapshot) regadoSnapshot = snapshot;
  });
  const unsubscribeNodo = nodo.manager.subscribe((snapshot) => {
    if (snapshot) nodoSnapshot = snapshot;
  });
  const unsubscribeAppearance = appearance.manager.subscribe((snapshot) => {
    if (snapshot) appearanceSnapshot = snapshot;
  });
  const unsubscribeMediaSettings = mediaSettings.manager.subscribe((snapshot) => {
    if (!snapshot) return;
    mediaSettingsSnapshot = snapshot;
    void rondo.state.configureMedia(snapshot);
  });
  const unsubscribeRondo = rondo.manager.subscribe((snapshot) => {
    if (snapshot) rondoSnapshot = snapshot;
  });
  const unsubscribeLigo = ligo.manager.subscribe((snapshot) => {
    if (snapshot) ligoSnapshot = snapshot;
  });

  onMount(() => {
    appearance.start();
    mediaSettings.start();
    auth.start();
  });

  onDestroy(() => {
    closeContextMenu();
    unsubscribeAuth();
    unsubscribeAppearance();
    unsubscribeMediaSettings();
    unsubscribeRegado();
    unsubscribeRondo();
    unsubscribeLigo();
    unsubscribeNodo();
    unsubscribeFluo();
    unsubscribeCanvas();
    unsubscribeWorkspace();
    editor.shutdown();
    regado.shutdown();
    nodo.shutdown();
    rondo.shutdown();
    ligo.shutdown();
    appearance.shutdown();
    mediaSettings.shutdown();
    auth.shutdown();
  });

  function authenticate(mode: AuthMode, username: string, password: string) {
    return auth.state.authenticate(mode, username, password);
  }

  async function logout() {
    if (isLoggingOut) return;
    isLoggingOut = true;
    try {
      const workspaceId = editor.workspaceState.snapshot.active?.id;
      if (workspaceId) await editor.canvas.settleWorkspaceWrites(workspaceId);
      await auth.state.logout();
    } finally {
      isLoggingOut = false;
    }
  }

  async function retryWorkspaceLibrary() {
    const loaded = await editor.workspaceState.loadLibrary();
    await tick();
    if (loaded) filesPanel?.focusTitle();
    else filesPanel?.focusRetry();
  }

  function openCreateWorkspaceDialog() {
    editor.workspaceState.clearCreateWorkspaceError();
    isCreateWorkspaceOpen = true;
  }

  async function closeCreateWorkspaceDialog() {
    if (workspaceSnapshot.isCreatingWorkspace) return;
    isCreateWorkspaceOpen = false;
    editor.workspaceState.clearCreateWorkspaceError();
    await tick();
    editorPanel?.focusCreateWorkspace();
  }

  async function createWorkspace(name: string) {
    const created = await editor.createWorkspace(name);
    if (!created) return;
    isCreateWorkspaceOpen = false;
    flushSync();
    header?.focusBack();
  }

  async function openFile(file: WorkspaceSummary) {
    await editor.openWorkspace(file);
  }

  async function deleteFile(file: WorkspaceSummary) {
    const deleted = await editor.deleteWorkspace(file.id);
    if (!deleted) return;
    await tick();
    filesPanel?.focusTitle();
  }

  async function retryOpenWorkspace() {
    const opened = await editor.retryOpenWorkspace();
    await tick();
    if (opened) objectsPanel?.focusNewObject();
    else editorPanel?.focusRetry();
  }

  async function closeFile() {
    editor.closeWorkspace();
    await tick();
    filesPanel?.focusTitle();
  }

  function navigate(section: AppSection) {
    if (activeSection === section) return;
    closeContextMenu();
    editor.canvas.clearInteractions();
    isCreateWorkspaceOpen = false;
    isCreateObjectOpen = false;
    activeSection = section;
    if (section === 'regado') regado.start();
    else regado.stop();
    if (section === 'nodo') nodo.start();
    else nodo.stop();
    if (section === 'fluo') editor.startFluo();
    else editor.stopFluo();
    if (section === 'rondo') rondo.start();
    else rondo.stop();
    if (section === 'ligo') ligo.start();
    else ligo.stop();
  }

  function markPresent() {
    auth.state.markPresent();
  }

  function setTheme(theme: AppTheme) {
    appearance.state.setTheme(theme);
  }

  function setScale(scale: AppScale) {
    editor.canvas.clearInteractions();
    appearance.state.setScale(scale);
  }

  function setTextScale(textScale: TextScale) {
    appearance.state.setTextScale(textScale);
  }

  function openCreateObjectDialog() {
    if (!workspaceSnapshot.active) return;
    editor.workspaceState.clearCreateObjectError();
    isCreateObjectOpen = true;
  }

  async function closeCreateObjectDialog() {
    if (workspaceSnapshot.isCreatingObject) return;
    isCreateObjectOpen = false;
    editor.workspaceState.clearCreateObjectError();
    await tick();
    objectsPanel?.focusNewObject();
  }

  async function createObject(title: string) {
    const created = await editor.workspaceState.createObject(title);
    if (!created) return;
    isCreateObjectOpen = false;
    flushSync();
    objectsPanel?.focusNewObject();
  }
</script>

<svelte:head>
  <title>{authSnapshot.phase === 'authenticated'
    ? `${appSectionLabel(activeSection)} · Kaordo`
    : 'Welcome · Kaordo'}</title>
</svelte:head>

<svelte:window
  onblur={() => editor.canvas.clearInteractions()}
  oncontextmenu={(event) => event.preventDefault()}
  onfocus={markPresent}
  onkeydown={markPresent}
  onpointerdown={markPresent}
/>

{#if authSnapshot.phase === 'authenticated'}
<div
  class="app-shell"
  inert={isModalOpen}
  aria-hidden={isModalOpen ? 'true' : undefined}
>
  <AppHeader
    bind:this={header}
    {activeFile}
    {activeSection}
    onBack={closeFile}
    onNavigate={navigate}
    sections={appSectionsFor(authSnapshot.user?.role ?? 'user')}
  />

  <div class="app-content">
    <main
      class="workspace-shell"
      class:workspace-shell--with-objects={activeFile !== null}
      class:app-section--hidden={activeSection !== 'klaro'}
      aria-label="Kaordo application workspace"
    >
      <h1 class="visually-hidden">Kaordo application workspace</h1>

      <FilesPanel
        bind:this={filesPanel}
        files={workspaceSnapshot.files}
        activeFileId={activeFile?.id ?? null}
        loading={workspaceSnapshot.libraryPhase === 'loading'}
        error={workspaceSnapshot.libraryError}
        warnings={workspaceSnapshot.libraryWarnings}
        {platform}
        onOpen={openFile}
        onDelete={deleteFile}
        onRetry={retryWorkspaceLibrary}
      />

      <EditorPanel
        bind:this={editorPanel}
        canvas={editor.canvas}
        {canvasSnapshot}
        fileCount={workspaceSnapshot.files.length}
        onCreateWorkspace={openCreateWorkspaceDialog}
        onRetryOpen={retryOpenWorkspace}
        {platform}
        {storageLocation}
        {workspaceSnapshot}
      />

      {#if activeFile}
        <ObjectsPanel
          bind:this={objectsPanel}
          canvas={editor.canvas}
          {canvasSnapshot}
          isOpening={workspaceSnapshot.openPhase === 'opening'}
          onNewObject={openCreateObjectDialog}
          openError={workspaceSnapshot.openError}
          workspace={workspaceSnapshot.active}
        />
      {/if}
    </main>

    {#if activeSection === 'fluo'}
      <FluoFeed snapshot={fluoSnapshot} fluoState={editor.fluoState} />
    {:else if activeSection === 'mi' && authSnapshot.user}
      <ProfileSection
        busy={isLoggingOut}
        error={authSnapshot.error}
        onLogout={logout}
        {platform}
        publicStorage={fluoSnapshot.publicStorage}
        user={authSnapshot.user}
      />
    {:else if activeSection === 'regado' && authSnapshot.user?.role !== 'user'}
      <RegadoSection
        snapshot={regadoSnapshot}
        onRefresh={() => regado.state.refresh()}
      />
    {:else if activeSection === 'agordoj'}
      <SettingsSection
        media={mediaSettingsSnapshot}
        onMediaReset={() => mediaSettings.state.reset()}
        onMicrophone={(deviceId) => mediaSettings.state.setMicrophone(deviceId)}
        onMicrophoneVolume={(volume) => mediaSettings.state.setMicrophoneVolume(volume)}
        snapshot={appearanceSnapshot}
        onReset={() => appearance.state.reset()}
        onScale={setScale}
        onTextScale={setTextScale}
        onTheme={setTheme}
        onSpeaker={(deviceId) => mediaSettings.state.setSpeaker(deviceId)}
        onSpeakerVolume={(volume) => mediaSettings.state.setSpeakerVolume(volume)}
      />
    {:else if activeSection === 'nodo'}
      <NodoSection
        snapshot={nodoSnapshot}
        onClear={clearNodoStorage}
        onClearPrivate={clearPrivateNodoStorage}
        onDelete={(nodeId) => nodo.state.deleteNode(nodeId)}
        onPolicy={(nodeId, policy) => nodo.state.updatePolicy(nodeId, policy)}
        onSpaces={(nodeId, publicQuotaBytes) => nodo.state.updateSpaces(nodeId, publicQuotaBytes)}
        onQuickTest={(nodeId) => nodo.state.requestQuickTest(nodeId)}
        onRefresh={() => nodo.state.refresh()}
      />
    {:else if activeSection === 'rondo'}
      <RondoSection media={mediaSettingsSnapshot} snapshot={rondoSnapshot} state={rondo.state} />
    {:else if activeSection === 'ligo'}
      <LigoSection snapshot={ligoSnapshot} state={ligo.state} />
    {/if}
  </div>

  <StatusBar {platform} section={activeSection} />
</div>

{#if activeSection === 'klaro' && canvasSnapshot.floatingObject}
  <FloatingDragCard
    canvas={editor.canvas}
    object={canvasSnapshot.floatingObject}
    overCanvas={canvasSnapshot.isDropTarget}
  />
{/if}

<ContextMenu />

{#if showCreateWorkspace}
  <CreateWorkspaceDialog
    busy={workspaceSnapshot.isCreatingWorkspace}
    error={workspaceSnapshot.createWorkspaceError}
    onCreate={createWorkspace}
    onCancel={closeCreateWorkspaceDialog}
    {platform}
    {storageLocation}
  />
{/if}

{#if isCreateObjectOpen && workspaceSnapshot.active}
  <CreateObjectDialog
    workspaceName={workspaceSnapshot.active.name}
    busy={workspaceSnapshot.isCreatingObject}
    error={workspaceSnapshot.createObjectError}
    onCreate={createObject}
    onCancel={closeCreateObjectDialog}
  />
{/if}
{:else}
  <AuthScreen
    snapshot={authSnapshot}
    onAuthenticate={authenticate}
    onClearError={() => auth.state.clearError()}
    {platform}
  />
{/if}

<style>
  .app-shell {
    display: grid;
    grid-template-rows: 56px minmax(0, 1fr) 28px;
    width: 100%;
    height: 100%;
    background: var(--canvas);
    animation: shell-enter 260ms ease-out both;
  }

  .workspace-shell {
    display: grid;
    grid-template-columns: minmax(224px, 256px) minmax(480px, 1fr);
    min-height: 0;
    background: var(--canvas);
  }

  .app-content {
    display: grid;
    min-width: 0;
    min-height: 0;
  }

  .app-content > :global(*) {
    grid-area: 1 / 1;
  }

  .app-section--hidden {
    display: none;
  }

  .workspace-shell--with-objects {
    grid-template-columns:
      minmax(224px, 256px) minmax(480px, 1fr) minmax(264px, 304px);
  }

  @keyframes shell-enter {
    from {
      transform: translateY(2px);
    }

    to {
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .app-shell {
      animation: none;
    }
  }
</style>
