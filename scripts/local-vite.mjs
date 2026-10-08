// Defines local Vite topology and shared media dependency preparation

export const localFrontendServers = [
  { id: 'portal', name: 'Portal', port: 8765, base: '', readyPath: '/login/' },
  { id: 'fluo', name: 'Fluo', port: 18766, base: '/fluo', readyPath: '/fluo/' },
  { id: 'ligo', name: 'Ligo', port: 18767, base: '/ligo', readyPath: '/ligo/' },
  { id: 'rondo', name: 'Rondo', port: 18768, base: '/rondo', readyPath: '/rondo/' },
  { id: 'regado', name: 'Regado', port: 18769, base: '/regado', readyPath: '/regado/' },
  { id: 'lingvo', name: 'Lingvo', port: 18770, base: '/lingvo', readyPath: '/lingvo/' },
  { id: 'memoro', name: 'Memoro', port: 18771, base: '/memoro', readyPath: '/memoro/' }
];

export const localDevelopmentPorts = [
  { name: 'Kerno', port: 8081 },
  { name: 'Nodo', port: 8082 },
  ...localFrontendServers.map(({ name, port }) => ({ name: `${name} Vite`, port }))
];

/**
 * @param {string} appId
 * @returns {undefined | {
 *   host: string;
 *   port: number;
 *   strictPort: boolean;
 *   proxy?: Record<string, { target: string; ws: boolean }>;
 *   ws?: { path: string; clientPort: number };
 * }}
 */
export function localViteServer(appId) {
  const environment = /** @type {{ process?: { env?: Record<string, string | undefined> } }} */ (globalThis).process?.env ?? {};
  if (environment.KAORDO_LOCAL_DEV !== '1') return undefined;

  const app = localFrontendServers.find(({ id }) => id === appId);
  if (!app) throw new Error(`Unknown local Vite app: ${appId}`);

  const common = {
    host: '127.0.0.1',
    port: app.port,
    strictPort: true
  };

  if (app.id === 'portal') {
    return {
      ...common,
      proxy: Object.fromEntries(localFrontendServers
        .filter(({ id }) => id !== 'portal')
        .map(({ base, port }) => [base, { target: `http://127.0.0.1:${port}`, ws: true }]))
    };
  }

  return {
    ...common,
    ws: {
      path: '/__vite_hmr',
      clientPort: localFrontendServers[0].port
    }
  };
}

// Prepare lazy upload libraries without bundling the workspace's in-memory auth module
export const mediaDependencies = ['@uppy/core', '@uppy/tus', 'pica', 'tus-js-client']
  .map(dependency => `@kaordo/media-client > ${dependency}`);

// Prepare the shared editor so the first composer opening does not trigger a dependency reload
export const editorDependencies = ['@tiptap/core', '@tiptap/extension-file-handler', '@tiptap/extension-placeholder', '@tiptap/starter-kit']
  .map(dependency => `@kaordo/editor-ui > ${dependency}`);
