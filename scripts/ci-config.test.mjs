// Prevents new regression files from silently falling outside the declared test suites

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import browserConfig from '../playwright.config.mjs';
import auditConfig from '../playwright.audit.config.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const files = readdirSync(import.meta.dirname).filter((name) =>
	/\.(?:test|integration)\.mjs$/.test(name)
);
const unitFiles = new Set(
	manifest.scripts['test:unit'].match(/scripts\/[\w.-]+\.mjs/g).map((path) => path.slice(8))
);
const browserFiles = new Set(browserConfig.projects.flatMap(({ testMatch }) => testMatch));
const artifactFiles = new Set(['pages.test.mjs', 'pages-production.test.mjs']);
const databaseFiles = new Set(
	manifest.scripts['test:product:db'].match(/scripts\/[\w.-]+\.mjs/g).map((path) => path.slice(8))
);

test('hosted browser shards use native test-level distribution with one fixture owner per runner', () => {
	const workflow = readFileSync(
		new URL('../.github/workflows/checks.yml', import.meta.url),
		'utf8'
	);
	assert.match(workflow, /fail-fast: false\s+matrix:\s+shard: \[1, 2, 3\]/);
	assert.match(
		workflow,
		/run: pnpm test:ui --fully-parallel --workers=1 --shard=\$\{\{ matrix\.shard \}\}\/3/
	);
	assert.match(workflow, /name: browser-failure-\$\{\{ matrix\.shard \}\}/);
});

test('browser and live jobs share pinned Chromium setup using the official signed Ubuntu archive', () => {
	const workflow = readFileSync(
		new URL('../.github/workflows/checks.yml', import.meta.url),
		'utf8'
	);
	const setup = readFileSync(
		new URL('../.github/actions/setup-chromium/action.yml', import.meta.url),
		'utf8'
	);
	assert.equal(workflow.match(/uses: \.\/\.github\/actions\/setup-chromium/g)?.length, 2);
	assert.match(setup, /sudo bash scripts\/ci-ubuntu-mirror\.sh/);
	assert.match(setup, /pnpm exec playwright install --with-deps chromium --only-shell/);
	assert.doesNotMatch(setup, /allow-unauthenticated|trusted=yes|curl.*\|.*(?:sh|bash)/);
});

test('Ubuntu setup replaces direct and mirror-file sources without changing signing or package selection', () => {
	const directory = mkdtempSync(join(tmpdir(), 'kaordo-ci-apt-'));
	const script = fileURLToPath(new URL('./ci-ubuntu-mirror.sh', import.meta.url));
	const template = (uri) =>
		`Types: deb\nURIs: ${uri}\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`;
	try {
		for (const uri of [
			'http://azure.archive.ubuntu.com/ubuntu/',
			'https://azure.archive.ubuntu.com/ubuntu/',
			'mirror+file:/etc/apt/apt-mirrors.txt',
			'https://archive.ubuntu.com/ubuntu/'
		]) {
			const path = join(directory, 'ubuntu.sources');
			const security = template('mirror+file:/etc/apt/apt-security-mirrors.txt').replace(
				'noble noble-updates noble-backports',
				'noble-security'
			);
			writeFileSync(path, template(uri) + '\n' + security);
			const result = spawnSync('bash', [script, path], { encoding: 'utf8' });
			assert.equal(result.status, 0, result.stderr);
			const expected =
				template('https://archive.ubuntu.com/ubuntu' + (uri.endsWith('/') ? '/' : '')) +
				'\n' +
				security.replace(
					'mirror+file:/etc/apt/apt-security-mirrors.txt',
					'https://security.ubuntu.com/ubuntu'
				);
			assert.equal(readFileSync(path, 'utf8'), expected, uri);
		}
		const path = join(directory, 'unknown.sources');
		writeFileSync(path, template('mirror+file:/etc/apt/new-runner-mirrors.txt'));
		assert.notEqual(
			spawnSync('bash', [script, path]).status,
			0,
			'Unknown mirror selection cannot silently keep the slow source'
		);
		assert.equal(
			readFileSync(path, 'utf8'),
			template('mirror+file:/etc/apt/new-runner-mirrors.txt')
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('every regression file has an explicit unit, browser, live, database or artifact suite', () => {
	assert.deepEqual(
		files.filter(
			(name) =>
				!unitFiles.has(name) &&
				!browserFiles.has(name) &&
				!artifactFiles.has(name) &&
				!databaseFiles.has(name)
		),
		[],
		'Assign new regression files to test:unit, a Playwright project or an artifact verification suite'
	);
	for (const name of [...unitFiles, ...browserFiles, ...artifactFiles, ...databaseFiles]) {
		assert.ok(files.includes(name), `Declared regression file must exist: ${name}`);
	}
});

test('live integration includes complete identity/product journeys and isolated backup recovery', () => {
	const live = browserConfig.projects.find(({ name }) => name === 'live');
	assert.deepEqual(live.testMatch, ['auth-live.integration.mjs', 'backup-live.integration.mjs']);
	assert.equal(live.use.trace, 'off', 'Credential flows cannot record network traces');
	assert.equal(
		live.use.screenshot,
		'off',
		'Native identity forms expose temporary recovery credentials'
	);
	assert.equal(browserConfig.retries, 0, 'Retries cannot hide a failed regression');
	assert.match(manifest.scripts['test:integration'], /--project=live --workers=1/);
	assert.doesNotMatch(manifest.scripts['test:integration'], /--grep|identity-only/);
});

test('browser engine audit preserves every synthetic scenario without credential traces or retries', () => {
	const scenarios = browserConfig.projects.find(({ name }) => name === 'browser').testMatch;
	const [webkit, firefox, clipboard] = auditConfig.projects;
	assert.equal(
		auditConfig.workers,
		1,
		'One owner must generate Vite source during engine verification'
	);
	assert.equal(auditConfig.retries, 0);
	assert.equal(
		auditConfig.webServer,
		undefined,
		'The synthetic audit cannot start credential services'
	);
	assert.deepEqual(webkit.testMatch, scenarios);
	assert.deepEqual(firefox.testMatch, scenarios);
	assert.deepEqual(clipboard.testMatch, ['product-ui.test.mjs']);
	assert.equal(
		clipboard.use.headless,
		false,
		'Native PNG paste requires a platform clipboard in Firefox'
	);
	assert.ok(clipboard.grep.test('Ligo pastes clipboard media'));
	assert.ok(firefox.grepInvert.test('Ligo pastes clipboard media'));
	assert.ok(!webkit.grepInvert.test('Ligo pastes clipboard media'));
	for (const project of auditConfig.projects) {
		assert.ok(!project.testMatch.includes('auth-live.integration.mjs'));
	}
});
