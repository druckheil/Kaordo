// Applies production identity policy and preserves managed settings for release rollback
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { restoreKeycloak, snapshotKeycloak, syncKeycloak } from '../../scripts/sync-keycloak.mjs';

const bootstrap = parseEnv(await readFile('/srv/kaordo/secrets/keycloak-admin.env', 'utf8'));

const privateConfig = {
	KEYCLOAK_ADMIN_USERNAME: bootstrap.KC_BOOTSTRAP_ADMIN_USERNAME,
	KEYCLOAK_ADMIN_PASSWORD: bootstrap.KC_BOOTSTRAP_ADMIN_PASSWORD
};
const [mode, path, ...extra] = process.argv.slice(2);
if (extra.length || (mode && (!['--snapshot', '--restore'].includes(mode) || !path))) {
	throw new Error('Use no arguments, --snapshot <private file>, or --restore <private file>.');
}
if (mode === '--snapshot') {
	await writeFile(path, JSON.stringify(await snapshotKeycloak(privateConfig)), {
		mode: 0o600,
		flag: 'wx'
	});
} else if (mode === '--restore') {
	await restoreKeycloak(privateConfig, JSON.parse(await readFile(path, 'utf8')));
} else {
	await syncKeycloak(privateConfig, fetch, 'http://127.0.0.1:8080', {
		realmPath: resolve(import.meta.dirname, 'kaordo-realm.json'),
		siteOrigin: 'https://kaordo.link'
	});
}

console.log(
	`Kaordo production identity ${mode === '--snapshot' ? 'snapshot saved' : mode === '--restore' ? 'settings restored' : 'policy synchronized and verified'}.`
);
