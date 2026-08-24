import 'vidstack/player';
import 'vidstack/player/layouts/default';
import 'vidstack/player/ui';
import 'vidstack/player/styles/default/theme.css';
import 'vidstack/player/styles/default/layouts/video.css';
import './styles.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { createAuthGateway } from './lib/gateways/createAuthGateway';
import { createAdminGateway } from './lib/gateways/createAdminGateway';
import { createAppearanceGateway } from './lib/gateways/createAppearanceGateway';
import { createWorkspaceGateway } from './lib/gateways/createWorkspaceGateway';
import { createNodoGateway } from './lib/gateways/createNodoGateway';
import { createRondoGateway } from './lib/gateways/createRondoGateway';
import { createLigoGateway } from './lib/gateways/createLigoGateway';
import { createProfileGateway } from './lib/gateways/createProfileGateway';
import { createIloGateway } from './lib/gateways/createIloGateway';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Application mount point was not found.');
}

const nodoGateway = createNodoGateway();
const workspaceGateway = createWorkspaceGateway();

// A transparent Tauri window needs transparent document roots so the
// desktop-only border radius can reveal the native window background. Keep
// the browser build opaque and unchanged.
if (workspaceGateway.platform === 'desktop') {
  document.documentElement.dataset.kaordoPlatform = 'desktop';
}

const app = mount(App, {
  target,
  props: {
    adminGateway: createAdminGateway(),
    appearanceGateway: createAppearanceGateway(),
    authGateway: createAuthGateway(),
    nodoGateway,
    ligoGateway: createLigoGateway(),
    iloGateway: createIloGateway(),
    profileGateway: createProfileGateway(nodoGateway),
    rondoGateway: createRondoGateway(),
    workspaceGateway,
  },
});

export default app;
