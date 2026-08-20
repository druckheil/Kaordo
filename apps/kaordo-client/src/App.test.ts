import { invoke } from '@tauri-apps/api/core';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import type { AuthUser } from './lib/domain/auth';
import type { PublicNodoStorage } from './lib/domain/nodo';
import type { AuthGateway } from './lib/gateways/AuthGateway';
import type { FluoGateway, RemoteFluoPost } from './lib/gateways/FluoGateway';
import type { NodoGateway } from './lib/gateways/NodoGateway';
import type { FluoDraftAttachment } from './lib/states/FluoGState';
import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from './lib/domain/workspace';
import { TauriWorkspaceGateway } from './lib/gateways/TauriWorkspaceGateway';
import { WebWorkspaceGateway } from './lib/gateways/WebWorkspaceGateway';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

const researchFile = {
  id: 'workspace-1',
  name: 'Research',
  path: '/tmp/Research.vdw',
};

const openedResearch = {
  ...researchFile,
  objects: [
    {
      id: 'object-1',
      title: 'Project brief',
      type: 'Knowledge object',
    },
  ],
  warnings: [],
};

const signedInUser: AuthUser = {
  createdAt: 1_700_000_000,
  id: 'user-1',
  role: 'user',
  username: 'Nova_User',
};

const adminDashboard = {
  capacity: {
    d1: { accountStorageBytes: 5_000_000_000, databaseBytes: 500_000_000, databases: 10, rowsReadDaily: 5_000_000, rowsWrittenDaily: 100_000, timeTravelDays: 7 },
    r2: { classAOperationsMonthly: 1_000_000, classBOperationsMonthly: 10_000_000, storageBytesMonthly: 10_000_000_000 },
    turn: { egressBytesMonthly: 1_000_000_000_000, overageUsdPerGb: 0.05 },
    worker: { cpuMsPerRequest: 10, cronTriggers: 5, memoryBytes: 134_217_728, requestsDaily: 100_000, scripts: 100, simultaneousConnections: 6, startupMs: 1_000, subrequestsPerRequest: 50, workerBytes: 3_145_728 },
  },
  generatedAt: Math.floor(Date.now() / 1_000),
  usage: {
    activeSessions: 2,
    cloudflare: {
      d1: { databaseCount: 1, queryLatencyP90Ms: 0.7, readQueriesToday: 12, responseBytesToday: 4_000, rowsReadToday: 120, rowsWrittenToday: 8, storageBytes: 45_056, writeQueriesToday: 3 },
      periods: { dailyResetAt: Math.floor(Date.now() / 1_000) + 3_600, monthlyStartedAt: 1_700_000_000 },
      r2: { bucketCount: 0, classAOperationsThisMonth: 0, classBOperationsThisMonth: 0, objectCount: 0, storageBytes: 0, unclassifiedOperationsThisMonth: 0 },
      sampledAt: Math.floor(Date.now() / 1_000),
      turn: { averageConcurrentConnections: 0.5, egressBytesThisMonth: 75_000_000, ingressBytesThisMonth: 12_000_000 },
      worker: { cpuTimeP50Ms: 0.4, cpuTimeP99Ms: 1.2, errorsToday: 2, requestsToday: 341, subrequestsToday: 26 },
    },
    databaseBytes: 45_056,
    onlineUsers: 1,
    totalUsers: 2,
  },
  users: [
    { activeSessions: 1, createdAt: 1_700_000_000, id: 'admin-1', lastSeenAt: Math.floor(Date.now() / 1_000), online: true, role: 'superadmin' as const, status: 'active' as const, username: 'druckheil' },
    { activeSessions: 1, createdAt: 1_700_000_100, id: 'user-1', lastSeenAt: 1_700_000_100, online: false, role: 'user' as const, status: 'active' as const, username: 'Nova_User' },
  ],
};

const adminGateway = {
  cloudflare: () => Promise.resolve(adminDashboard.usage.cloudflare),
  dashboard: () => Promise.resolve(adminDashboard),
};
const appearanceGateway = {
  load: () => ({ scale: 1 as const, textScale: 1, theme: 'light' as const }),
  save: () => Promise.resolve(),
};

const fluoNode = {
  createdAt: 1_700_000_000,
  deviceName: 'Living room tablet',
  diagnostics: { completedAt: null, requestedAt: null, running: false },
  id: '8dbb2352-c02b-4a4e-a169-f6b5f13fd19c',
  lastSeenAt: Math.floor(Date.now() / 1_000),
  localAddresses: ['192.168.1.44'],
  metrics: {
    androidSdk: 31,
    appVersion: '0.3.0',
    batteryPercent: 82,
    charging: true,
    coordinatorLatencyMs: 24,
    diskReadBps: null,
    diskWriteBps: null,
    memoryAvailableBytes: null,
    memoryTotalBytes: null,
    networkMetered: false,
    networkDownBps: null,
    networkType: 'wifi' as const,
    networkUpBps: null,
    storageAvailableBytes: 40_000_000_000,
  },
  observedAddress: null,
  online: true,
  policy: { allowDownloads: true, allowUploads: true, chargingOnly: false, ownerOnly: true as const, wifiOnly: true },
  port: 49_321,
  protocol: 'tus/1.0.0',
  quotaBytes: 30 * 1_073_741_824,
  spaces: {
    private: { quotaBytes: 30 * 1_073_741_824, usedBytes: 0 },
    public: { quotaBytes: 0, usedBytes: 0 },
  },
  usedBytes: 0,
};

function authenticatedGateway(): AuthGateway {
  return {
    currentUser: () => Promise.resolve(signedInUser),
    login: () => Promise.resolve(signedInUser),
    logout: () => Promise.resolve(),
    presence: () => Promise.resolve(),
    register: () => Promise.resolve(signedInUser),
  };
}

type CommandHandler = (args?: Record<string, unknown>) => unknown | Promise<unknown>;

function mockCommands(handlers: Record<string, CommandHandler>) {
  vi.mocked(invoke).mockImplementation(((command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command];
    if (command === 'load_canvas_document' && !handler) return Promise.resolve(null);
    if (command === 'save_canvas_document' && !handler) return Promise.resolve(undefined);
    if (!handler) return Promise.reject(new Error(`Unexpected command: ${command}`));
    return Promise.resolve(handler(args));
  }) as typeof invoke);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function renderApp(
  props: {
    autoloadWorkspaceLibrary?: boolean;
    files?: WorkspaceSummary[];
    workspace?: WorkspaceDetail | null;
  } = {},
) {
  const fluoGateway = new MemoryFluoGateway();
  return render(App, {
    ...props,
    adminGateway,
    appearanceGateway,
    authGateway: authenticatedGateway(),
    fluoGateway,
    initialAuthUser: signedInUser,
    nodoGateway: memoryNodoGateway(),
    workspaceGateway: new TauriWorkspaceGateway(),
  });
}

function memoryNodoGateway(): NodoGateway {
  return {
    accessNode: () => Promise.reject(new Error('Direct transport is mocked separately.')),
    cancelPublicStorage: () => Promise.resolve(),
    clearStorage: () => Promise.resolve({ deletedBytes: 0, deletedPosts: 0, deletedUploads: 0 }),
    clearPrivateStorage: () => Promise.resolve({ deletedBytes: 0, deletedPosts: 0, deletedUploads: 0 }),
    commitPublicStorage: () => Promise.resolve(),
    deleteNode: () => Promise.resolve(),
    listNodes: () => Promise.resolve([fluoNode]),
    listFeedNodeIds: () => Promise.resolve([fluoNode.id]),
    publicStorage: () => Promise.resolve({
      limitBytes: 1_073_741_824,
      nodeCandidates: [{ availableBytes: 1_073_741_824, deviceName: fluoNode.deviceName, nodeId: fluoNode.id }],
      reservedBytes: 0,
      usedBytes: 0,
    }),
    releasePublicPost: () => Promise.resolve(),
    renewPublicStorage: () => Promise.resolve({ expiresAt: 1_900_000_000, reservationId: '123e4567-e89b-42d3-a456-426614174099' }),
    reservePublicStorage: () => Promise.resolve({ expiresAt: 1_900_000_000, reservationId: '123e4567-e89b-42d3-a456-426614174099' }),
    requestQuickTest: () => Promise.resolve({ completedAt: 0, diskReadBps: 1, diskWriteBps: 1 }),
    updatePolicy: (_nodeId, policy) => Promise.resolve({ ...policy, ownerOnly: true }),
    updateSpaces: () => Promise.resolve(fluoNode.spaces),
  };
}

class MemoryFluoGateway implements FluoGateway {
  posts: RemoteFluoPost[] = [];

  listFeedPage(): Promise<{ cursor: null; hasMore: false; posts: RemoteFluoPost[] }> {
    return Promise.resolve({ cursor: null, hasMore: false, posts: this.posts });
  }
  loadMedia(): Promise<{ blob: Blob }> { return Promise.resolve({ blob: new Blob() }); }

  publishPost(
    _nodeId: string,
    body: string,
    attachments: readonly FluoDraftAttachment[],
  ): Promise<RemoteFluoPost> {
    const post: RemoteFluoPost = {
      attachments: attachments.map(({ blob, url: _url, ...attachment }) => ({ ...attachment, blob })),
      author: signedInUser.username,
      body,
      createdAt: Date.now(),
      id: `post-${this.posts.length + 1}`,
      nodeId: _nodeId,
      space: _nodeId === 'public' ? 'public' : 'private',
    };
    this.posts = [post, ...this.posts];
    return Promise.resolve(post);
  }

  deletePost(_nodeId: string, postId: string): Promise<void> {
    this.posts = this.posts.filter(({ id }) => id !== postId);
    return Promise.resolve();
  }
}

async function openResearchFile() {
  await fireEvent.click(screen.getByRole('button', { name: /Research\.vdw/ }));
  const createObjectButton = await screen.findByRole('button', { name: 'New Object' });
  const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
  await waitFor(() => {
    expect(canvas).not.toHaveClass('canvas-viewport--camera-pending');
  });
  return createObjectButton;
}

function mockCanvasViewportSize(width: number, height: number) {
  const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth',
  );
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.classList.contains('canvas-viewport') ? width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.classList.contains('canvas-viewport') ? height : 0;
    },
  });

  return () => {
    if (clientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
    } else {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  };
}

describe('workspace navigation and objects', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('shows Files without Objects or Inspector before a file is opened', () => {
    renderApp({ autoloadWorkspaceLibrary: false });

    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Objects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Inspector' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Workspace' })).toBeInTheDocument();
  });

  it('defaults to Public Nodo and can publish to a selected private Nodo', async () => {
    renderApp({ autoloadWorkspaceLibrary: false });

    const navigation = screen.getByRole('navigation', {
      name: 'Kaordo sections',
    });
    expect(within(navigation).getByRole('button', { name: 'Klaro' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Fluo' }));
    expect(screen.getByRole('heading', { name: 'Global timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Files' }).closest('main')).toHaveClass(
      'app-section--hidden',
    );

    const composer = screen.getByRole('textbox', { name: 'Post text' });
    await fireEvent.input(composer, { target: { value: 'Hello from this device.' } });
    expect(screen.getByLabelText('Post storage node')).toHaveValue('public');
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled();
    await fireEvent.change(screen.getByLabelText('Post storage node'), {
      target: { value: fluoNode.id },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Hello from this device.')).toBeInTheDocument();

    await fireEvent.contextMenu(screen.getByText('Hello from this device.').closest('article')!);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete post' }));
    expect(screen.getByText('Delete this post?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByText('Hello from this device.')).not.toBeInTheDocument();

    await fireEvent.click(
      within(navigation).getByRole('button', { name: 'Ligo' }),
    );
    expect(screen.getByRole('heading', { name: 'Ligo' })).toBeInTheDocument();

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Rondo' }));
    expect(screen.getByRole('heading', { name: 'Rondo' })).toBeInTheDocument();

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Klaro' }));
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
  });

  it('shows the current account in Mi and logs out to the authentication screen', async () => {
    const logout = vi.fn(() => Promise.resolve());
    const authGateway: AuthGateway = {
      ...authenticatedGateway(),
      logout,
    };
    render(App, {
      adminGateway,
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway,
      initialAuthUser: signedInUser,
      workspaceGateway: new TauriWorkspaceGateway(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Mi' }));
    expect(screen.getByRole('heading', { name: 'Mi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nova_User' })).toBeInTheDocument();
    expect(screen.getByText('user-1')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Files' })).not.toBeInTheDocument();
  });

  it('loads Public Nodo independently in Mi and shows its loading state', async () => {
    const storage = deferred<PublicNodoStorage>();
    const nodoGateway = memoryNodoGateway();
    const publicStorage = vi.fn(() => storage.promise);
    nodoGateway.publicStorage = publicStorage;
    render(App, {
      adminGateway,
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway: authenticatedGateway(),
      initialAuthUser: signedInUser,
      nodoGateway,
      workspaceGateway: new TauriWorkspaceGateway(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Mi' }));
    const storageCard = screen.getByRole('region', { name: 'Public Nodo' });
    expect(publicStorage).toHaveBeenCalled();
    expect(within(storageCard).getByRole('status')).toHaveTextContent('Loading…');

    storage.resolve({
      limitBytes: 1_073_741_824,
      nodeCandidates: [],
      reservedBytes: 0,
      usedBytes: 12 * 1_048_576,
    });
    expect(await within(storageCard).findByText('12.0 MB')).toBeInTheDocument();
    expect(within(storageCard).getByText('of 1.00 GB')).toBeInTheDocument();
  });

  it('loads and manages the signed-in users Nodo hosts', async () => {
    const clearStorage = vi.fn(async () => ({ deletedBytes: 1_073_741_824, deletedPosts: 1, deletedUploads: 1 }));
    const clearPrivateStorage = vi.fn(async () => ({ deletedBytes: 1_073_741_824, deletedPosts: 1, deletedUploads: 1 }));
    const updatePolicy = vi.fn(async (_nodeId, policy) => ({ ...policy, ownerOnly: true as const }));
    const requestQuickTest = vi.fn(async () => ({
      completedAt: 1_800_000_000,
      diskReadBps: 120_000_000,
      diskWriteBps: 80_000_000,
    }));
    const updateSpaces = vi.fn(async (_nodeId: string, spaces: { privateQuotaBytes: number; publicQuotaBytes: number }) => ({
      private: { quotaBytes: spaces.privateQuotaBytes, usedBytes: 1_073_741_824 },
      public: { quotaBytes: spaces.publicQuotaBytes, usedBytes: 0 },
    }));
    const node = {
      createdAt: 1_700_000_000,
      deviceName: 'Samsung Tablet',
      diagnostics: { completedAt: null, requestedAt: null, running: false },
      id: '8dbb2352-c02b-4a4e-a169-f6b5f13fd19c',
      lastSeenAt: Math.floor(Date.now() / 1_000),
      localAddresses: ['192.168.1.44'],
      metrics: {
        androidSdk: 31,
        appVersion: '0.13.0',
        batteryPercent: 82,
        charging: true,
        coordinatorLatencyMs: 24,
        diskReadBps: 220_000_000,
        diskWriteBps: 105_000_000,
        memoryAvailableBytes: 2_000_000_000,
        memoryTotalBytes: 6_000_000_000,
        networkMetered: false,
        networkDownBps: 100_000_000,
        networkType: 'wifi' as const,
        networkUpBps: 50_000_000,
        storageAvailableBytes: 40_000_000_000,
      },
      observedAddress: '203.0.113.10',
      online: true,
      policy: { allowDownloads: true, allowUploads: true, chargingOnly: false, ownerOnly: true as const, wifiOnly: false },
      port: 49_321,
      protocol: 'tus/1.0.0',
      quotaBytes: 30 * 1_073_741_824,
      spaces: {
        private: { quotaBytes: 30 * 1_073_741_824, usedBytes: 1_073_741_824 },
        public: { quotaBytes: 0, usedBytes: 0 },
      },
      usedBytes: 1_073_741_824,
    };
    render(App, {
      adminGateway,
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway: authenticatedGateway(),
      initialAuthUser: signedInUser,
      nodoGateway: {
        accessNode: () => Promise.reject(new Error('Not used in this test.')),
        cancelPublicStorage: () => Promise.resolve(),
        clearStorage,
        clearPrivateStorage,
        commitPublicStorage: () => Promise.resolve(),
        deleteNode: () => Promise.resolve(),
        listNodes: () => Promise.resolve([node]),
        listFeedNodeIds: () => Promise.resolve([node.id]),
        publicStorage: () => Promise.resolve({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
        releasePublicPost: () => Promise.resolve(),
        renewPublicStorage: () => Promise.reject(new Error('Not used in this test.')),
        reservePublicStorage: () => Promise.reject(new Error('Not used in this test.')),
        requestQuickTest,
        updatePolicy,
        updateSpaces,
      },
      workspaceGateway: new TauriWorkspaceGateway(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Nodo' }));
    expect(await screen.findByRole('heading', { name: 'Samsung Tablet' })).toBeInTheDocument();
    expect(screen.getAllByText('30.0 GB').length).toBeGreaterThan(0);
    expect(screen.getByText('82% · charging')).toBeInTheDocument();
    expect(screen.getByText('24 ms to coordinator')).toBeInTheDocument();
    expect(screen.getByText('Battery').closest('article')).toHaveAttribute('data-health', 'Excellent');
    expect(screen.getByText('Disk write').closest('article')).toHaveAttribute('data-health', 'Good');
    const spacesSummary = screen.getByText('Spaces').closest('article')!;
    expect(within(spacesSummary).getByText('Private')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete Private…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Private' }));
    expect(clearPrivateStorage).toHaveBeenCalledWith(node.id);

    await fireEvent.input(screen.getByRole('slider', { name: 'Public storage allocation' }), {
      target: { value: String(10 * 1_073_741_824) },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply split' }));
    expect(updateSpaces).toHaveBeenCalledWith(node.id, {
      privateQuotaBytes: 20 * 1_073_741_824,
      publicQuotaBytes: 10 * 1_073_741_824,
    });

    await fireEvent.click(screen.getByRole('button', { name: /^Public$/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply split' }));
    expect(updateSpaces).toHaveBeenLastCalledWith(node.id, {
      privateQuotaBytes: 0,
      publicQuotaBytes: 30 * 1_073_741_824,
    });
    await waitFor(() => expect(within(spacesSummary).getByText('Public')).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('switch', { name: 'Wi-Fi only' }));
    expect(updatePolicy).toHaveBeenCalledWith(node.id, {
      allowDownloads: true,
      allowUploads: true,
      chargingOnly: false,
      wifiOnly: true,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    expect(requestQuickTest).toHaveBeenCalledWith(node.id);
    expect(await screen.findByText('114 MB/s')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete content…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(clearStorage).toHaveBeenCalledWith(node.id);
    expect((await screen.findAllByText('0 B')).length).toBeGreaterThan(0);

    await fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove node' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Fluo' }));
    expect(screen.queryByRole('option', { name: /Samsung Tablet/ })).not.toBeInTheDocument();
  });

  it('uses browser-specific storage copy with the web gateway', async () => {
    render(App, {
      adminGateway,
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway: authenticatedGateway(),
      initialAuthUser: signedInUser,
      workspaceGateway: new WebWorkspaceGateway(),
    });

    expect(
      screen.getByRole('heading', { name: 'Create a browser workspace' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Browser workspace')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
    expect(screen.getByText('Browser storage')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Give your browser workspace a clear name. It stays on this device.',
      ),
    ).toBeInTheDocument();
  });

  it('shows Regado only to administrators and loads its two sections', async () => {
    render(App, {
      adminGateway,
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway: authenticatedGateway(),
      initialAuthUser: { ...signedInUser, role: 'superadmin', username: 'druckheil' },
      workspaceGateway: new TauriWorkspaceGateway(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Regado' }));
    expect(await screen.findByRole('heading', { name: 'Cloudflare capacity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('druckheil')).toBeInTheDocument();
    expect(screen.getByText('341 / 100K')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TURN relay' })).toBeInTheDocument();
    expect(screen.getByText('75.0 MB / 1.00 TB')).toBeInTheDocument();
  });

  it('refreshes only the Regado data source requested by a field button', async () => {
    const cloudflare = vi.fn(() => Promise.resolve(adminDashboard.usage.cloudflare));
    const dashboard = vi.fn(() => Promise.resolve(adminDashboard));
    render(App, {
      adminGateway: { cloudflare, dashboard },
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway: authenticatedGateway(),
      initialAuthUser: { ...signedInUser, role: 'superadmin', username: 'druckheil' },
      workspaceGateway: new TauriWorkspaceGateway(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Regado' }));
    await screen.findByRole('heading', { name: 'Cloudflare capacity' });
    expect(cloudflare).toHaveBeenCalledWith(false);
    expect(dashboard).toHaveBeenCalledWith(false);

    const dashboardCalls = dashboard.mock.calls.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh Cloudflare usage' }));
    await waitFor(() => expect(cloudflare).toHaveBeenLastCalledWith(true));
    expect(dashboard).toHaveBeenCalledTimes(dashboardCalls);

    const cloudflareCalls = cloudflare.mock.calls.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh users' }));
    await waitFor(() => expect(dashboard).toHaveBeenLastCalledWith(true));
    expect(cloudflare).toHaveBeenCalledTimes(cloudflareCalls);
  });

  it('applies global theme and interface scale from Agordoj', async () => {
    const save = vi.fn(() => Promise.resolve());
    const saveMedia = vi.fn(() => Promise.resolve());
    render(App, {
      adminGateway,
      appearanceGateway: {
        load: () => ({ scale: 1 as const, textScale: 1, theme: 'light' as const }),
        save,
      },
      autoloadWorkspaceLibrary: false,
      authGateway: authenticatedGateway(),
      initialAuthUser: signedInUser,
      mediaSettingsGateway: {
        load: () => ({
          microphoneId: '',
          microphoneVolume: 100,
          speakerId: '',
          speakerVolume: 100,
        }),
        save: saveMedia,
      },
      workspaceGateway: new TauriWorkspaceGateway(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Agordoj' }));
    expect(screen.getByRole('heading', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Display' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Audio & Video' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));
    await fireEvent.input(screen.getByLabelText('Text size'), { target: { value: '125' } });
    await fireEvent.click(screen.getByRole('radio', { name: '130 percent' }));
    await fireEvent.input(screen.getByLabelText('Microphone volume'), { target: { value: '140' } });
    await fireEvent.input(screen.getByLabelText('Speaker volume'), { target: { value: '65' } });

    expect(save).toHaveBeenCalledWith({ scale: 1, textScale: 1, theme: 'dark' });
    expect(save).toHaveBeenCalledWith({ scale: 1, textScale: 1.25, theme: 'dark' });
    expect(save).toHaveBeenLastCalledWith({ scale: 1.3, textScale: 1.25, theme: 'dark' });
    expect(screen.getByLabelText('Current text size')).toHaveTextContent('125%');
    expect(screen.getByLabelText('Current interface scale')).toHaveTextContent('130%');
    expect(saveMedia).toHaveBeenCalledWith({
      microphoneId: '',
      microphoneVolume: 140,
      speakerId: '',
      speakerVolume: 100,
    });
    expect(saveMedia).toHaveBeenLastCalledWith({
      microphoneId: '',
      microphoneVolume: 140,
      speakerId: '',
      speakerVolume: 65,
    });
  });

  it('loads only workspace summaries from the library at startup', async () => {
    mockCommands({
      list_workspaces: () => ({ files: [researchFile], warnings: [] }),
    });

    renderApp();

    expect(await screen.findByRole('button', { name: /Research\.vdw/ })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('list_workspaces');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Objects' })).not.toBeInTheDocument();
  });

  it('keeps valid files visible when another workspace cannot be listed', async () => {
    mockCommands({
      list_workspaces: () => ({
        files: [researchFile],
        warnings: ['Broken.vdw: invalid manifest'],
      }),
    });

    renderApp();

    expect(await screen.findByRole('button', { name: /Research\.vdw/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 workspace file could not be loaded.',
    );
  });

  it('retries when the workspace library cannot be read', async () => {
    let attempt = 0;
    mockCommands({
      list_workspaces: () => {
        attempt += 1;
        if (attempt === 1) throw new Error('The workspace library is unavailable.');
        return { files: [researchFile], warnings: [] };
      },
    });

    renderApp();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The workspace library is unavailable.',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: /Research\.vdw/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Files' })).toHaveFocus();
    expect(invoke).toHaveBeenNthCalledWith(1, 'list_workspaces');
    expect(invoke).toHaveBeenNthCalledWith(2, 'list_workspaces');
  });

  it('keeps the custom workspace dialog keyboard-contained and restores focus', async () => {
    renderApp({ autoloadWorkspaceLibrary: false });
    const trigger = screen.getByRole('button', { name: 'Create Workspace' });

    await fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Create workspace' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'Workspace name' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const submit = within(dialog).getByRole('button', { name: 'Create workspace' });
    expect(nameInput).toHaveFocus();
    expect(within(dialog).getByText('Documents/Kaordo')).toBeInTheDocument();

    submit.focus();
    await fireEvent.keyDown(submit, { key: 'Tab' });
    expect(close).toHaveFocus();
    await fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(submit).toHaveFocus();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Create workspace' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('creates a workspace with its existing command and opens its empty Objects panel', async () => {
    const createdWorkspace = {
      id: 'workspace-2',
      name: 'Notes',
      path: '/tmp/Notes.vdw',
    };
    mockCommands({
      create_workspace: (args) => {
        expect(args).toEqual({ name: 'Notes' });
        return createdWorkspace;
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false });

    await fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
    const dialog = screen.getByRole('dialog', { name: 'Create workspace' });
    const input = within(dialog).getByRole('textbox', { name: 'Workspace name' });
    await fireEvent.input(input, { target: { value: 'Notes.vdw' } });
    expect(input).toHaveValue('Notes');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Create workspace' }));

    expect(invoke).toHaveBeenCalledWith('create_workspace', { name: 'Notes' });
    expect(screen.getByRole('button', { name: /Notes\.vdw/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { name: 'Objects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Object' })).toBeInTheDocument();
    expect(screen.getByText('No objects yet.')).toBeInTheDocument();
  });

  it('opens a file through open_workspace and renders draggable objects with a canvas', async () => {
    const opening = deferred<typeof openedResearch>();
    mockCommands({
      open_workspace: (args) => {
        expect(args).toEqual({ workspaceId: researchFile.id });
        return opening.promise;
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });

    await fireEvent.click(screen.getByRole('button', { name: /Research\.vdw/ }));

    expect(screen.getByRole('heading', { name: 'Opening workspace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Objects' })).toBeInTheDocument();
    expect(screen.queryByText('Project brief')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Object' })).not.toBeInTheDocument();

    opening.resolve(openedResearch);

    expect(await screen.findByText('Project brief')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Object' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('open_workspace', {
      workspaceId: researchFile.id,
    });
    const objectRow = screen.getByText('Project brief').closest('li');
    expect(objectRow).not.toBeNull();
    expect(
      within(objectRow as HTMLLIElement).getByRole('button', {
        name: 'Place Project brief on canvas',
      }),
    ).toHaveAttribute('title', 'Drag to canvas · Press Enter to place');
    expect(
      screen.getByRole('region', { name: 'Knowledge canvas' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Build your knowledge canvas')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Inspector' })).not.toBeInTheDocument();
  });

  it('replaces the native context menu with actions for each target', async () => {
    mockCommands({ open_workspace: () => openedResearch });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });

    const fileButton = screen.getByRole('button', { name: /Research\.vdw/ });
    const nativeMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 180,
      clientY: 120,
    });
    fileButton.dispatchEvent(nativeMenu);

    expect(nativeMenu.defaultPrevented).toBe(true);
    const fileMenu = await screen.findByRole('menu', {
      name: 'Research.vdw actions',
    });
    await fireEvent.click(
      within(fileMenu).getByRole('menuitem', { name: /Open Workspace/ }),
    );
    await screen.findByRole('button', { name: 'New Object' });

    const objectButton = screen.getByRole('button', {
      name: 'Place Project brief on canvas',
    });
    await fireEvent.contextMenu(objectButton, { clientX: 920, clientY: 180 });
    const objectMenu = screen.getByRole('menu', { name: 'Project brief actions' });
    expect(
      within(objectMenu).getByRole('menuitem', { name: 'Place on Canvas' }),
    ).toBeInTheDocument();

    const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
    await fireEvent.contextMenu(canvas, { clientX: 500, clientY: 400 });
    const canvasMenu = screen.getByRole('menu', { name: 'Canvas actions' });
    await fireEvent.click(
      within(canvasMenu).getByRole('menuitem', { name: 'Rectangle Tool' }),
    );
    expect(screen.getByRole('button', { name: 'Rectangle tool' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('confirms and deletes a workspace from its context panel', async () => {
    mockCommands({ delete_workspace: () => undefined });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    const fileButton = screen.getByRole('button', { name: /Research\.vdw/ });

    await fireEvent.contextMenu(fileButton);
    await fireEvent.click(
      screen.getByRole('menuitem', { name: 'Delete Workspace' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Delete Research.vdw?');
    expect(fileButton).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(fileButton).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith('delete_workspace', {
      workspaceId: researchFile.id,
    });
  });

  it('deletes an object and its canvas references from its context panel', async () => {
    mockCommands({
      delete_object: () => undefined,
      open_workspace: () => openedResearch,
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();
    const objectButton = screen.getByRole('button', {
      name: 'Place Project brief on canvas',
    });

    await fireEvent.contextMenu(objectButton);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Object' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(objectButton).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith('delete_object', {
      objectId: 'object-1',
      workspaceId: researchFile.id,
    });
    expect(invoke).toHaveBeenCalledWith('save_canvas_document', {
      documentJson: '{"elements":[],"placements":[],"version":1}',
      workspaceId: researchFile.id,
    });
  });

  it('opens the enlarged canvas at its center and places the first object there', async () => {
    const restoreViewportSize = mockCanvasViewportSize(800, 600);
    try {
      mockCommands({ open_workspace: () => openedResearch });
      renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
      await openResearchFile();

      const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
      expect(canvas.scrollLeft).toBe(2000);
      expect(canvas.scrollTop).toBe(1300);
      expect(document.querySelector('.canvas-surface')).toHaveStyle({
        height: '3200px',
        width: '4800px',
      });
      expect(document.querySelector('.canvas-origin')).toHaveStyle({
        left: '2400px',
        top: '1600px',
      });

      await fireEvent.keyDown(
        screen.getByRole('button', { name: 'Place Project brief on canvas' }),
        { key: 'Enter' },
      );
      const card = document.querySelector<HTMLElement>(
        '[data-canvas-object-id="object-1"]',
      );
      expect(card?.parentElement).toHaveStyle({
        transform: 'translate3d(2220px, 1457px, 0)',
      });
    } finally {
      restoreViewportSize();
    }
  });

  it('restores the last camera position after Back and reopening the file', async () => {
    const restoreViewportSize = mockCanvasViewportSize(800, 600);
    try {
      mockCommands({ open_workspace: () => openedResearch });
      renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
      await openResearchFile();

      await fireEvent.keyDown(
        screen.getByRole('button', { name: 'Place Project brief on canvas' }),
        { key: 'Enter' },
      );
      const firstCard = document.querySelector<HTMLElement>(
        '[data-canvas-object-id="object-1"]',
      );
      await fireEvent.animationEnd(firstCard as HTMLElement, {
        animationName: 'canvas-card-enter',
      });
      const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
      canvas.scrollLeft = 713;
      canvas.scrollTop = 421;
      await fireEvent.scroll(canvas);

      await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await openResearchFile();

      const reopenedCanvas = screen.getByRole('region', { name: 'Knowledge canvas' });
      expect(reopenedCanvas.scrollLeft).toBe(713);
      expect(reopenedCanvas.scrollTop).toBe(421);
      const reopenedCard = document.querySelector<HTMLElement>(
        '[data-canvas-object-id="object-1"]',
      );
      expect(reopenedCard).not.toHaveClass('canvas-card--entering');
    } finally {
      restoreViewportSize();
    }
  });

  it('places and moves an object on the canvas entirely from the keyboard', async () => {
    mockCommands({ open_workspace: () => openedResearch });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
    const source = screen.getByRole('button', {
      name: 'Place Project brief on canvas',
    });
    source.focus();
    await fireEvent.keyDown(source, { key: 'Enter' });

    const card = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        '[data-canvas-object-id="object-1"]',
      );
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    const dragHandle = within(card).getByRole('button', {
      name: /Project brief, Knowledge object/,
    });
    await waitFor(() => expect(dragHandle).toHaveFocus());
    expect(card.parentElement).toHaveStyle({
      transform: 'translate3d(40px, 72px, 0)',
    });
    expect(screen.getByText('1 placed')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Focus Project brief on canvas' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Project brief added to the canvas at 40, 72.'),
    ).toBeInTheDocument();

    await fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
    expect(card.parentElement).toHaveStyle({
      transform: 'translate3d(64px, 72px, 0)',
    });
    expect(screen.getByText('Project brief moved to 64, 72 on the canvas.')).toBeInTheDocument();
    await fireEvent.keyDown(dragHandle, { key: 'ArrowDown', shiftKey: true });
    expect(card.parentElement).toHaveStyle({
      transform: 'translate3d(64px, 120px, 0)',
    });
    expect(screen.getByText('Project brief moved to 64, 120 on the canvas.')).toBeInTheDocument();

    await fireEvent.keyDown(
      screen.getByRole('button', { name: 'Focus Project brief on canvas' }),
      { key: ' ' },
    );
    expect(document.querySelectorAll('[data-canvas-object-id="object-1"]')).toHaveLength(1);
    expect(screen.getByText('Project brief is already on the canvas.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Inspector' })).not.toBeInTheDocument();
  });

  it('gives consecutive keyboard placements distinct automatic positions', async () => {
    const objects = Array.from({ length: 7 }, (_, index) => ({
      id: `object-${index + 1}`,
      title: `Object ${index + 1}`,
      type: 'Knowledge object',
    }));
    mockCommands({
      open_workspace: () => ({ ...openedResearch, objects }),
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
    Object.defineProperties(canvas, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 900 },
    });
    for (const object of objects) {
      await fireEvent.keyDown(
        screen.getByRole('button', {
          name: `Place ${object.title} on canvas`,
        }),
        { key: 'Enter' },
      );
    }

    const positions = Array.from(
      document.querySelectorAll<HTMLElement>('[data-canvas-positioner-id]'),
      (positioner) => positioner.style.transform,
    );
    expect(positions).toHaveLength(7);
    expect(new Set(positions).size).toBe(7);
  });

  it('drops at scrolled canvas coordinates and redropping repositions one card', async () => {
    mockCommands({ open_workspace: () => openedResearch });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    const source = screen.getByRole('button', {
      name: 'Place Project brief on canvas',
    });
    const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      bottom: 650,
      height: 600,
      left: 100,
      right: 900,
      top: 50,
      width: 800,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });
    canvas.scrollLeft = 120;
    canvas.scrollTop = 90;
    await fireEvent.pointerDown(source, {
      button: 0,
      clientX: 1050,
      clientY: 150,
      pointerId: 8,
    });
    await fireEvent.pointerMove(source, {
      clientX: 500,
      clientY: 330,
      pointerId: 8,
    });
    expect(canvas).toHaveClass('canvas-viewport--drop-target');
    const floatingCard = document.querySelector<HTMLElement>('.object-drag-card');
    expect(floatingCard).not.toBeNull();
    expect(floatingCard).toHaveClass('canvas-card');
    expect(floatingCard).toHaveStyle({ height: '286px', width: '360px' });
    expect(floatingCard?.querySelector('.canvas-card-icon')).not.toBeNull();
    expect(floatingCard?.querySelector('.canvas-card-copy')).not.toBeNull();
    await fireEvent.pointerUp(source, {
      clientX: 500,
      clientY: 330,
      pointerId: 8,
    });

    const card = document.querySelector<HTMLElement>(
      '[data-canvas-object-id="object-1"]',
    );
    expect(card).not.toBeNull();
    const positioner = card!.parentElement as HTMLElement;
    expect(positioner).toHaveStyle({
      transform: 'translate3d(340px, 227px, 0)',
    });
    expect(card).toHaveClass('canvas-card--entering');
    expect(document.querySelector('.object-drag-card')).toBeNull();
    expect(canvas).not.toHaveClass('canvas-viewport--drop-target');
    await fireEvent.animationEnd(card as HTMLElement, {
      animationName: 'canvas-card-enter',
    });
    expect(card).not.toHaveClass('canvas-card--entering');

    vi.spyOn(positioner, 'getBoundingClientRect').mockReturnValue({
      bottom: 388,
      height: 116,
      left: 380,
      right: 620,
      top: 272,
      width: 240,
      x: 380,
      y: 272,
      toJSON: () => ({}),
    });
    const dragHandle = card!.querySelector<HTMLElement>('.canvas-card-drag-handle')!;
    await fireEvent.pointerDown(dragHandle, {
      button: 0,
      clientX: 400,
      clientY: 300,
      pointerId: 9,
    });
    await fireEvent.pointerMove(dragHandle, {
      clientX: 700,
      clientY: 500,
      pointerId: 9,
    });
    expect(positioner).toHaveStyle({
      transform: 'translate3d(700px, 512px, 0)',
    });
    expect(card).toHaveClass('canvas-card--dragging');
    expect(document.querySelector('.object-drag-card')).toBeNull();
    expect(screen.queryByText(/Project brief moved to/)).not.toBeInTheDocument();
    await fireEvent.pointerUp(dragHandle, {
      clientX: 700,
      clientY: 500,
      pointerId: 9,
    });

    expect(positioner).toHaveStyle({
      transform: 'translate3d(700px, 512px, 0)',
    });
    expect(card).not.toHaveClass('canvas-card--dragging');
    expect(card).not.toHaveClass('canvas-card--entering');
    expect(document.querySelectorAll('[data-canvas-object-id="object-1"]')).toHaveLength(1);
    expect(
      screen.getByText('Project brief moved to 700, 512 on the canvas.'),
    ).toBeInTheDocument();
  });

  it('draws a rectangle inside a card from the global toolbar and saves it', async () => {
    const savedDocuments: Record<string, unknown>[] = [];
    mockCommands({
      open_workspace: () => openedResearch,
      save_canvas_document: (args) => {
        savedDocuments.push(JSON.parse(String(args?.documentJson)));
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();
    await fireEvent.keyDown(
      screen.getByRole('button', { name: 'Place Project brief on canvas' }),
      { key: 'Enter' },
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Rectangle tool' }));
    const nestedCanvas = screen.getByRole('application', {
      name: 'Project brief tray',
    });
    vi.spyOn(nestedCanvas, 'getBoundingClientRect').mockReturnValue({
      bottom: 318,
      height: 218,
      left: 200,
      right: 558,
      top: 100,
      width: 358,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });
    await fireEvent.pointerDown(nestedCanvas, {
      button: 0,
      clientX: 224,
      clientY: 128,
      pointerId: 14,
    });
    await fireEvent.pointerMove(nestedCanvas, {
      clientX: 344,
      clientY: 208,
      pointerId: 14,
    });
    await fireEvent.pointerUp(nestedCanvas, {
      clientX: 344,
      clientY: 208,
      pointerId: 14,
    });

    expect(await screen.findByRole('button', { name: 'Rectangle' })).toBeInTheDocument();
    await waitFor(() => {
      expect(savedDocuments.some((document) =>
        Array.isArray(document.elements) && document.elements.length > 0,
      )).toBe(true);
    });
    expect(savedDocuments.at(-1)).toMatchObject({
      elements: [
        {
          height: 80,
          parentObjectId: 'object-1',
          type: 'rectangle',
          width: 120,
          x: 24,
          y: 28,
        },
      ],
      version: 1,
    });
  });

  it('draws and saves a rectangle directly on the workspace canvas', async () => {
    let savedDocument: Record<string, unknown> | null = null;
    mockCommands({
      open_workspace: () => openedResearch,
      save_canvas_document: (args) => {
        savedDocument = JSON.parse(String(args?.documentJson));
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    await fireEvent.click(screen.getByRole('button', { name: 'Rectangle tool' }));
    const drawingSurface = screen.getByRole('application', {
      name: 'Workspace canvas drawing surface',
    });
    vi.spyOn(drawingSurface, 'getBoundingClientRect').mockReturnValue({
      bottom: 3200,
      height: 3200,
      left: 0,
      right: 4800,
      top: 0,
      width: 4800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await fireEvent.pointerDown(drawingSurface, {
      button: 0,
      clientX: 420,
      clientY: 360,
      pointerId: 18,
    });
    await fireEvent.pointerMove(drawingSurface, {
      clientX: 600,
      clientY: 470,
      pointerId: 18,
    });
    await fireEvent.pointerUp(drawingSurface, {
      clientX: 600,
      clientY: 470,
      pointerId: 18,
    });

    expect(await screen.findByRole('button', { name: 'Canvas rectangle' }))
      .toBeInTheDocument();
    await waitFor(() => expect(savedDocument).not.toBeNull());
    expect(savedDocument).toMatchObject({
      elements: [
        {
          height: 110,
          type: 'rectangle',
          width: 180,
          x: 420,
          y: 360,
        },
      ],
      version: 1,
    });
  });

  it('creates, edits, formats, lists, and saves text on the canvas', async () => {
    const savedDocuments: Array<{
      elements: Array<Record<string, unknown>>;
    }> = [];
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    mockCommands({
      open_workspace: () => openedResearch,
      save_canvas_document: (args) => {
        savedDocuments.push(JSON.parse(String(args?.documentJson)));
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    await fireEvent.click(screen.getByRole('button', { name: 'Text tool' }));
    const drawingSurface = screen.getByRole('application', {
      name: 'Workspace canvas drawing surface',
    });
    vi.spyOn(drawingSurface, 'getBoundingClientRect').mockReturnValue({
      bottom: 3200,
      height: 3200,
      left: 0,
      right: 4800,
      top: 0,
      width: 4800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await fireEvent.pointerDown(drawingSurface, {
      button: 0,
      clientX: 500,
      clientY: 420,
      pointerId: 19,
    });

    const editor = await screen.findByRole('textbox', { name: 'Text editor' });
    expect(editor).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    editor.innerHTML = '<strong>Hello</strong> <u>world</u><img src=x onerror=alert(1)>';
    await fireEvent.input(editor);
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Bold' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(execCommand).toHaveBeenCalledWith('bold', false, undefined);
    await fireEvent.blur(editor);

    await waitFor(() => {
      const text = savedDocuments.at(-1)?.elements.find(
        (element) => element.type === 'text',
      );
      expect(text).toMatchObject({
        height: 48,
        html: '<strong>Hello</strong> <u>world</u>',
        type: 'text',
        width: 260,
        x: 480,
        y: 402,
      });
    });
    expect(
      await screen.findByRole('button', { name: 'Focus text: Hello world' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Text · Canvas')).toBeInTheDocument();
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: undefined,
    });
  });

  it('attaches newly created text to the rectangle under the pointer', async () => {
    const savedDocuments: Array<{
      elements: Array<Record<string, unknown>>;
    }> = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true),
    });
    mockCommands({
      load_canvas_document: () => JSON.stringify({
        elements: [
          {
            fill: '#dcece5',
            height: 120,
            id: 'rectangle-1',
            radius: 10,
            stroke: '#397565',
            strokeWidth: 2,
            type: 'rectangle',
            width: 200,
            x: 100,
            y: 100,
          },
        ],
        placements: [],
        version: 1,
      }),
      open_workspace: () => openedResearch,
      save_canvas_document: (args) => {
        savedDocuments.push(JSON.parse(String(args?.documentJson)));
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    const drawingSurface = screen.getByRole('application', {
      name: 'Workspace canvas drawing surface',
    });
    vi.spyOn(drawingSurface, 'getBoundingClientRect').mockReturnValue({
      bottom: 3200,
      height: 3200,
      left: 0,
      right: 4800,
      top: 0,
      width: 4800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Text tool' }));
    await fireEvent.pointerDown(
      await screen.findByRole('button', { name: 'Canvas rectangle' }),
      { button: 0, clientX: 140, clientY: 140, pointerId: 29 },
    );

    const editor = await screen.findByRole('textbox', { name: 'Text editor' });
    await waitFor(() => {
      const text = savedDocuments.at(-1)?.elements.find(
        (element) => element.type === 'text',
      );
      expect(text).toMatchObject({
        parentElementId: 'rectangle-1',
        type: 'text',
        x: 100,
        y: 122,
      });
    });
    expect(screen.getByText('Text · Rectangle')).toBeInTheDocument();
    await fireEvent.blur(editor);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: undefined,
    });
  });

  it('attaches a canvas shape to an object tray and detaches it when removed', async () => {
    const savedDocuments: Array<{
      elements: Array<Record<string, unknown>>;
    }> = [];
    mockCommands({
      open_workspace: () => openedResearch,
      load_canvas_document: () => JSON.stringify({
        elements: [
          {
            fill: '#dcece5',
            height: 50,
            id: 'rectangle-1',
            radius: 10,
            stroke: '#397565',
            strokeWidth: 2,
            type: 'rectangle',
            width: 50,
            x: 100,
            y: 100,
          },
        ],
        placements: [
          {
            height: 286,
            objectId: 'object-1',
            width: 360,
            x: 300,
            y: 300,
          },
        ],
        version: 1,
      }),
      save_canvas_document: (args) => {
        savedDocuments.push(JSON.parse(String(args?.documentJson)));
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    const drawingSurface = screen.getByRole('application', {
      name: 'Workspace canvas drawing surface',
    });
    vi.spyOn(drawingSurface, 'getBoundingClientRect').mockReturnValue({
      bottom: 3200,
      height: 3200,
      left: 0,
      right: 4800,
      top: 0,
      width: 4800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const globalRectangle = await screen.findByRole('button', {
      name: 'Canvas rectangle',
    });
    await fireEvent.pointerDown(globalRectangle, {
      button: 0,
      clientX: 110,
      clientY: 110,
      pointerId: 21,
    });
    await fireEvent.pointerMove(globalRectangle, {
      clientX: 335,
      clientY: 385,
      pointerId: 21,
    });
    expect(document.querySelector('.global-element-drag-layer'))
      .toBeInTheDocument();
    expect(globalRectangle).toHaveClass('global-rectangle--moving-source');
    await fireEvent.pointerUp(globalRectangle, {
      clientX: 335,
      clientY: 385,
      pointerId: 21,
    });

    const attachedRectangle = await screen.findByRole('button', {
      name: 'Rectangle',
    });
    expect(document.querySelector('.global-element-drag-layer'))
      .not.toBeInTheDocument();
    expect(
      attachedRectangle.closest('[data-canvas-positioner-id="object-1"]'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Canvas rectangle' }))
      .not.toBeInTheDocument();
    expect(savedDocuments.at(-1)?.elements[0]).toMatchObject({
      parentObjectId: 'object-1',
      x: 25,
      y: 27,
    });

    const tray = screen.getByRole('application', { name: 'Project brief tray' });
    vi.spyOn(tray, 'getBoundingClientRect').mockReturnValue({
      bottom: 586,
      height: 218,
      left: 300,
      right: 660,
      top: 368,
      width: 360,
      x: 300,
      y: 368,
      toJSON: () => ({}),
    });
    await fireEvent.pointerDown(attachedRectangle, {
      button: 0,
      clientX: 335,
      clientY: 385,
      pointerId: 22,
    });
    await fireEvent.pointerMove(attachedRectangle, {
      clientX: 35,
      clientY: 85,
      pointerId: 22,
    });
    await fireEvent.pointerUp(attachedRectangle, {
      clientX: 35,
      clientY: 85,
      pointerId: 22,
    });

    expect(await screen.findByRole('button', { name: 'Canvas rectangle' }))
      .toBeInTheDocument();
    expect(savedDocuments.at(-1)?.elements[0]).toMatchObject({ x: 25, y: 75 });
    expect(savedDocuments.at(-1)?.elements[0]).not.toHaveProperty('parentObjectId');
  });

  it('reconciles session canvas cards with objects reloaded from the workspace', async () => {
    let attempt = 0;
    mockCommands({
      open_workspace: () => {
        attempt += 1;
        return attempt === 1 ? openedResearch : { ...openedResearch, objects: [] };
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    await fireEvent.keyDown(
      screen.getByRole('button', { name: 'Place Project brief on canvas' }),
      { key: 'Enter' },
    );
    expect(document.querySelector('[data-canvas-object-id="object-1"]')).not.toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.click(screen.getByRole('button', { name: /Research\.vdw/ }));

    await screen.findByText('No objects yet.');
    expect(document.querySelector('[data-canvas-object-id="object-1"]')).toBeNull();
    expect(screen.getByText('0 placed')).toBeInTheDocument();
  });

  it('pans the two-axis canvas by dragging its background', async () => {
    mockCommands({ open_workspace: () => openedResearch });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await openResearchFile();

    const canvas = screen.getByRole('region', { name: 'Knowledge canvas' });
    canvas.scrollLeft = 300;
    canvas.scrollTop = 200;
    await fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 220,
      clientY: 180,
      pointerId: 7,
    });
    expect(canvas).toHaveClass('canvas-viewport--panning');
    await fireEvent.pointerMove(canvas, {
      clientX: 160,
      clientY: 100,
      pointerId: 7,
    });
    expect(canvas.scrollLeft).toBe(360);
    expect(canvas.scrollTop).toBe(280);
    await fireEvent.pointerUp(canvas, { pointerId: 7 });
    expect(canvas).not.toHaveClass('canvas-viewport--panning');
  });

  it('shows an open error and Retry reloads the workspace', async () => {
    let attempt = 0;
    mockCommands({
      open_workspace: () => {
        attempt += 1;
        if (attempt === 1) throw new Error('The workspace manifest is invalid.');
        return openedResearch;
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });

    await fireEvent.click(screen.getByRole('button', { name: /Research\.vdw/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The workspace manifest is invalid.',
    );
    const retry = screen.getByRole('button', { name: 'Retry' });
    await fireEvent.click(retry);

    expect(await screen.findByText('Project brief')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New Object' })).toHaveFocus();
    });
    expect(invoke).toHaveBeenNthCalledWith(1, 'open_workspace', {
      workspaceId: researchFile.id,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_workspace', {
      workspaceId: researchFile.id,
    });
  });

  it('Back keeps the file and reopening it reloads its objects from the backend', async () => {
    let attempt = 0;
    mockCommands({
      open_workspace: () => {
        attempt += 1;
        return attempt === 1
          ? openedResearch
          : {
              ...openedResearch,
              objects: [
                ...openedResearch.objects,
                {
                  id: 'object-2',
                  title: 'Reloaded object',
                  type: 'Knowledge object',
                },
              ],
            };
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    const fileButton = screen.getByRole('button', { name: /Research\.vdw/ });

    await openResearchFile();
    expect(await screen.findByText('Project brief')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByRole('heading', { name: 'Objects' })).not.toBeInTheDocument();
    expect(fileButton).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { name: 'Files' })).toHaveFocus();

    await fireEvent.click(fileButton);
    expect(await screen.findByText('Reloaded object')).toBeInTheDocument();
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === 'open_workspace'),
    ).toHaveLength(2);
  });

  it('opens a keyboard-contained Create object dialog and closes it with Cancel or Escape', async () => {
    mockCommands({ open_workspace: () => openedResearch });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    const trigger = await openResearchFile();

    await fireEvent.click(trigger);
    let dialog = screen.getByRole('dialog', { name: 'Create object' });
    const input = within(dialog).getByRole('textbox', { name: 'Object title' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const submit = within(dialog).getByRole('button', { name: 'Create object' });
    expect(input).toHaveFocus();

    submit.focus();
    await fireEvent.keyDown(submit, { key: 'Tab' });
    expect(close).toHaveFocus();
    await fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(submit).toHaveFocus();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Create object' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await fireEvent.click(trigger);
    dialog = screen.getByRole('dialog', { name: 'Create object' });
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Create object' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === 'open_workspace'),
    ).toHaveLength(1);
  });

  it('validates object titles and keeps backend errors in the dialog', async () => {
    mockCommands({
      open_workspace: () => openedResearch,
      create_object: (args) => {
        expect(args).toEqual({ workspaceId: researchFile.id, title: 'Draft' });
        throw new Error('The object could not be written.');
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    await fireEvent.click(await openResearchFile());
    const dialog = screen.getByRole('dialog', { name: 'Create object' });
    const input = within(dialog).getByRole('textbox', { name: 'Object title' });
    const submit = within(dialog).getByRole('button', { name: 'Create object' });

    await fireEvent.click(submit);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter an object title.');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === 'create_object'),
    ).toHaveLength(0);

    await fireEvent.input(input, { target: { value: 'é'.repeat(101) } });
    await fireEvent.click(submit);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Object titles must be 200 bytes or fewer.',
    );
    expect(input).toHaveFocus();
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === 'create_object'),
    ).toHaveLength(0);

    await fireEvent.input(input, { target: { value: '  Draft  ' } });
    await fireEvent.click(submit);

    expect(invoke).toHaveBeenCalledWith('create_object', {
      workspaceId: researchFile.id,
      title: 'Draft',
    });
    expect(screen.getByRole('dialog', { name: 'Create object' })).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The object could not be written.',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute(
      'aria-describedby',
      'object-title-help object-create-error',
    );
  });

  it('creates an object, adds it first in Objects, and restores trigger focus', async () => {
    const createdObject = {
      id: 'object-2',
      title: 'Interview notes',
      type: 'Knowledge object' as const,
      warning: 'The object was saved, but durability could not be confirmed.',
    };
    mockCommands({
      open_workspace: () => openedResearch,
      create_object: (args) => {
        expect(args).toEqual({
          workspaceId: researchFile.id,
          title: 'Interview notes',
        });
        return createdObject;
      },
    });
    renderApp({ autoloadWorkspaceLibrary: false, files: [researchFile] });
    const trigger = await openResearchFile();
    await fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Create object' });
    await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Object title' }), {
      target: { value: 'Interview notes' },
    });

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Create object' }));

    expect(screen.queryByRole('dialog', { name: 'Create object' })).not.toBeInTheDocument();
    expect(screen.getByText('Project brief')).toBeInTheDocument();
    expect(screen.getByText('Interview notes')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Objects in this workspace' }))
        .getAllByRole('listitem')
        .map((item) => item.querySelector('strong')?.textContent),
    ).toEqual(['Interview notes', 'Project brief']);
    expect(
      screen.getByText('The object was saved, but durability could not be confirmed.'),
    ).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(invoke).toHaveBeenCalledWith('create_object', {
      workspaceId: researchFile.id,
      title: 'Interview notes',
    });
  });
});

describe('authentication gate', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('keeps the workspace unmounted until a valid login succeeds', async () => {
    const login = vi.fn(() => Promise.resolve(signedInUser));
    const authGateway: AuthGateway = {
      currentUser: () => Promise.resolve(null),
      login,
      logout: () => Promise.resolve(),
      presence: () => Promise.resolve(),
      register: () => Promise.resolve(signedInUser),
    };

    render(App, {
      adminGateway,
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway,
      workspaceGateway: new TauriWorkspaceGateway(),
    });

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Files' })).not.toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText('Username'), {
      target: { value: 'Nova_User' },
    });
    await fireEvent.input(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith('Nova_User', 'correct horse battery staple');
  });

  it('validates registration before sending credentials', async () => {
    const register = vi.fn(() => Promise.resolve(signedInUser));
    const authGateway: AuthGateway = {
      currentUser: () => Promise.resolve(null),
      login: () => Promise.resolve(signedInUser),
      logout: () => Promise.resolve(),
      presence: () => Promise.resolve(),
      register,
    };

    render(App, {
      adminGateway,
      appearanceGateway,
      autoloadWorkspaceLibrary: false,
      authGateway,
      workspaceGateway: new TauriWorkspaceGateway(),
    });
    await screen.findByRole('heading', { name: 'Welcome back' });
    await fireEvent.click(screen.getByRole('tab', { name: 'Register' }));
    await fireEvent.input(screen.getByLabelText('Username'), {
      target: { value: 'Nova_User' },
    });
    await fireEvent.input(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    await fireEvent.input(screen.getByLabelText('Confirm password'), {
      target: { value: 'different password value' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(register).not.toHaveBeenCalled();
  });
});
