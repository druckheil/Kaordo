// Verifies one release manifest against its payload, installed files and public responses
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requiredFiles = [
	'bin/kerno',
	'bin/nodo',
	'bin/regado-agent',
	'etc/nixos/deploy/nixos/kaordo.nix',
	'etc/nixos/deploy/nixos/cd.nix',
	'etc/nixos/deploy/nixos/deploy.mjs',
	'etc/nixos/deploy/nixos/deployment-report.mjs',
	'etc/nixos/deploy/nixos/deploy-release.sh',
	'etc/nixos/deploy/nixos/kaordo-realm.json',
	'etc/nixos/deploy/nixos/sync-keycloak-production.mjs',
	'etc/nixos/scripts/sync-keycloak.mjs',
	'etc/nixos/deploy/keycloak/themes/kaordo/login/resources/js/session.js',
	'site/index.html',
	'site/fluo/index.html',
	'site/ligo/index.html',
	'site/rondo/index.html',
	'site/lingvo/index.html',
	'site/memoro/index.html',
	'site/regado/index.html',
	'site/silent-check-sso.html'
];

export async function verifyPayload(
	directory,
	expectedRelease,
	expectedOrigin,
	expectedRealm,
	expectedCommit
) {
	const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
	if (
		manifest.format !== 1 ||
		manifest.release !== expectedRelease ||
		!/^[a-f0-9]{40}$/.test(manifest.sourceCommit) ||
		manifest.origin !== expectedOrigin ||
		manifest.realm !== expectedRealm ||
		(expectedCommit && manifest.sourceCommit !== expectedCommit)
	) {
		throw new Error('Release manifest does not match the requested deployment.');
	}
	for (const path of requiredFiles) {
		if (!manifest.files[path]) throw new Error(`Release manifest is missing ${path}.`);
	}
	for (const [path, hash] of Object.entries(manifest.files)) {
		if (!/^[a-f0-9]{64}$/.test(hash) || path.startsWith('/') || path.split('/').includes('..')) {
			throw new Error('Release manifest contains an invalid file entry.');
		}
		const file = join(directory, path);
		if (!(await lstat(file)).isFile() || digest(await readFile(file)) !== hash) {
			throw new Error(`Release payload differs from its manifest: ${path}`);
		}
	}
	return manifest;
}

export async function verifyLiveRelease(
	directory,
	manifest,
	{ dataRoot = '/srv/kaordo', configurationRoot = '/etc/nixos', fetcher = fetch } = {}
) {
	for (const [path, hash] of Object.entries(manifest.files)) {
		const installed = path.startsWith('bin/')
			? join(dataRoot, path)
			: path.startsWith('site/')
				? join(dataRoot, 'www/current', path.slice(5))
				: path.startsWith('etc/nixos/')
					? join(configurationRoot, path.slice(10))
					: null;
		if (installed && digest(await readFile(installed)) !== hash) {
			throw new Error(`Installed release differs from the manifest: ${path}`);
		}
	}
	async function response(url, expectedStatus = 200) {
		const result = await fetcher(url, {
			headers: { 'Accept-Language': 'en' },
			signal: AbortSignal.timeout(15_000)
		});
		if (result.status !== expectedStatus)
			throw new Error(`Release check returned HTTP ${result.status}: ${new URL(url).pathname}`);
		return Buffer.from(await result.arrayBuffer());
	}
	for (const app of ['', 'fluo/', 'ligo/', 'rondo/', 'lingvo/', 'memoro/', 'regado/']) {
		const path = `site/${app}index.html`;
		if (digest(await response(`${manifest.origin}/${app}`)) !== manifest.files[path]) {
			throw new Error(`Public application differs from the release: ${app || 'portal'}`);
		}
	}
	if (
		digest(await response(`${manifest.origin}/silent-check-sso.html`)) !==
		manifest.files['site/silent-check-sso.html']
	) {
		throw new Error('Public silent SSO page differs from the release.');
	}
	const identity = `${manifest.origin}/realms/${manifest.realm}`;
	const discovery = JSON.parse(
		(await response(`${identity}/.well-known/openid-configuration`)).toString()
	);
	if (discovery.issuer !== identity)
		throw new Error('Public OIDC issuer differs from the release origin.');
	await response(`${identity}/protocol/openid-connect/login-status-iframe.html`);
	await response(`${identity}/protocol/openid-connect/3p-cookies/step1.html`);
	const loginUrl = new URL(`${identity}/protocol/openid-connect/auth`);
	loginUrl.search = new URLSearchParams({
		client_id: 'kaordo-web',
		redirect_uri: `${manifest.origin}/silent-check-sso.html`,
		response_type: 'code',
		scope: 'openid',
		kc_locale: 'en',
		code_challenge: digest('kaordo-release-login-verification'),
		code_challenge_method: 'S256'
	}).toString();
	const html = (await response(loginUrl)).toString();
	if (!/name="rememberMe"/.test(html) || !html.includes('Stay signed in')) {
		throw new Error('Public login does not expose the configured Stay signed in option.');
	}
	const themePrefix = 'etc/nixos/deploy/keycloak/themes/kaordo/login/resources/';
	const properties = await readFile(
		join(directory, 'etc/nixos/deploy/keycloak/themes/kaordo/login/theme.properties'),
		'utf8'
	);
	const resources = properties
		.split('\n')
		.filter((line) => /^(scripts|styles)=/.test(line))
		.flatMap((line) =>
			line
				.slice(line.indexOf('=') + 1)
				.trim()
				.split(/\s+/)
		);
	const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
		(match) => new URL(match[1].replaceAll('&amp;', '&'), loginUrl)
	);
	for (const resource of resources) {
		const hash = manifest.files[`${themePrefix}${resource}`];
		if (!hash) continue;
		const url = urls.find((item) => item.pathname.endsWith(`/login/kaordo/${resource}`));
		if (!url || url.origin !== manifest.origin || digest(await response(url)) !== hash) {
			throw new Error(`Public Keycloak theme differs from the release: ${resource}`);
		}
	}
	await response('http://127.0.0.1:8081/healthz', 204);
	await response('http://127.0.0.1:8082/healthz', 204);
	await response('http://127.0.0.1:7880/');
	await response('http://127.0.0.1:9090/-/ready');
	await response('http://127.0.0.1:9100/metrics');
	await response(
		`${manifest.origin}/v1/fluo/posts/01a10fd2-692b-7966-be35-037f86108801/thread`,
		401
	);
	// Device-encrypted stores and Lingvo are routed and require a session
	for (const path of ['/v1/crypto/identity', '/v1/memoro/month', '/v1/lingvo/catalog'])
		await response(`${manifest.origin}${path}`, 401);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const [mode, directory, release, origin, realm] = process.argv.slice(2);
	if (!['payload', 'live'].includes(mode))
		throw new Error('Specify payload or live release verification.');
	const manifest = await verifyPayload(directory, release, origin, realm);
	if (mode === 'live') await verifyLiveRelease(directory, manifest);
	console.log(`Verified ${mode} release ${release} from ${manifest.sourceCommit}.`);
}
