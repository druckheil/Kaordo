import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { syncKeycloak } from '../../scripts/sync-keycloak.mjs';

const bootstrap = parseEnv(await readFile('/srv/kaordo/secrets/keycloak-admin.env', 'utf8'));

await syncKeycloak({
  KEYCLOAK_ADMIN_USERNAME: bootstrap.KC_BOOTSTRAP_ADMIN_USERNAME,
  KEYCLOAK_ADMIN_PASSWORD: bootstrap.KC_BOOTSTRAP_ADMIN_PASSWORD
});

console.log('Kaordo production realm security and client scopes are synchronized.');
