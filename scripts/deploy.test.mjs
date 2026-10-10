// Exercises which GitHub Actions runs may replace production and how their releases are verified

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deploy, githubClient, parseWorkflow, unpackRelease } from '../deploy/nixos/deploy.mjs';

const workflow = parseWorkflow('owner/app/.github/workflows/checks.yml@refs/heads/main');
const revision = 'a'.repeat(40);
const active = 'b'.repeat(40);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const zip = Buffer.from('synthetic-artifact');
const archive = Buffer.from('synthetic-release');
const release = {
	id: `v0.0.4-${revision.slice(0, 12)}-20261010T120000Z`,
	hash: sha256(archive),
	sourceCommit: revision
};

const scratch = mkdtemp(join(tmpdir(), 'kaordo-deploy-test-'));
test.after(async () => rm(await scratch, { recursive: true, force: true }));

// GitHub as it answers for run 7, a push to main at revision that passed its checks
function scenario(changes = {}) {
	const answers = {
		'actions/runs/7': {
			head_sha: revision,
			event: 'push',
			head_branch: 'main',
			path: '.github/workflows/checks.yml'
		},
		'actions/runs/7/jobs?filter=all&per_page=100': {
			jobs: [{ name: 'checks', conclusion: 'success' }]
		},
		'branches/main': { commit: { sha: revision } },
		[`compare/${active}...${revision}`]: { status: 'ahead' },
		'actions/runs/7/artifacts?name=production-release': {
			artifacts: [
				{ id: 9, name: 'production-release', expired: false, digest: `sha256:${sha256(zip)}` }
			]
		},
		'actions/artifacts/9/zip': zip,
		...changes.github
	};
	const events = [];
	const dependencies = {
		workflow,
		github: async (path) => {
			events.push(path);
			if (!(path in answers)) throw new Error(`unexpected ${path}`);
			return answers[path];
		},
		production: async () => ({
			sourceCommit: active,
			origin: 'https://example.test',
			realm: 'app',
			...changes.production
		}),
		unpack: async () => {
			const path = join(await scratch, `release-${events.length}.tar.gz`);
			await writeFile(path, changes.archive ?? archive);
			return { release: { ...release, ...changes.release }, archive: path };
		},
		install: async (installed, path, production) => {
			events.push(`install ${installed.id} ${production.realm}`);
			return changes.exit ?? 0;
		},
		report: async (entry) => events.push(`report ${entry.state}`)
	};
	return { events, run: () => deploy(7, dependencies) };
}

test('the trusted branch head installs its own release on top of production', async () => {
	const { events, run } = scenario();
	const result = await run();
	assert.equal(result.state, 'succeeded');
	assert.equal(result.revision, revision);
	assert.equal(events[1], 'report deploying');
	assert.equal(events.at(-1), `install ${release.id} app`);
});

test('a run that is not the trusted push or has not passed its checks never downloads', async () => {
	for (const details of [
		{ event: 'workflow_dispatch' },
		{ head_branch: 'feature' },
		{ path: '.github/workflows/other.yml' }
	]) {
		const { events, run } = scenario({
			github: {
				'actions/runs/7': {
					head_sha: revision,
					event: 'push',
					head_branch: 'main',
					path: '.github/workflows/checks.yml',
					...details
				}
			}
		});
		assert.equal((await run()).state, 'failed');
		assert.ok(!events.some((event) => event.includes('artifacts')));
	}
	const { events, run } = scenario({
		github: {
			'actions/runs/7/jobs?filter=all&per_page=100': {
				jobs: [{ name: 'checks', conclusion: 'failure' }]
			}
		}
	});
	assert.match((await run()).message, /has not passed its checks/);
	assert.ok(!events.some((event) => event.startsWith('install')));
});

test('an older run is superseded and a revision production runs needs nothing', async () => {
	const moved = scenario({ github: { 'branches/main': { commit: { sha: 'c'.repeat(40) } } } });
	const superseded = await moved.run();
	assert.equal(superseded.state, 'superseded');
	assert.match(superseded.message, /moved on to ccccccc/);
	const current = scenario({ production: { sourceCommit: revision } });
	assert.equal((await current.run()).state, 'succeeded');
	for (const { events } of [moved, current])
		assert.ok(!events.some((event) => event.includes('artifacts')));
});

test('a revision outside production history is refused', async () => {
	for (const status of ['behind', 'diverged']) {
		const { events, run } = scenario({
			github: { [`compare/${active}...${revision}`]: { status } }
		});
		assert.match((await run()).message, /Production runs bbbbbbb, which aaaaaaa does not contain/);
		assert.ok(!events.some((event) => event.includes('artifacts')));
	}
});

test('a download or release that differs from what the run built is never installed', async () => {
	for (const changes of [
		{ github: { 'actions/runs/7/artifacts?name=production-release': { artifacts: [] } } },
		{ github: { 'actions/artifacts/9/zip': Buffer.from('tampered') } },
		{ release: { sourceCommit: active } },
		{ release: { id: '../escape' } },
		{ archive: Buffer.from('tampered') }
	]) {
		const { events, run } = scenario(changes);
		assert.equal((await run()).state, 'failed', JSON.stringify(changes));
		assert.ok(!events.some((event) => event.startsWith('install')));
	}
});

test('a rejected release keeps the previous one and a failed rollback is marked for an operator', async () => {
	const rejected = await scenario({ exit: 1 }).run();
	assert.deepEqual([rejected.state, rejected.rollbackFailed], ['failed', undefined]);
	assert.match(rejected.message, /keeps the previous release/);
	const stuck = await scenario({ exit: 70 }).run();
	assert.deepEqual([stuck.state, stuck.rollbackFailed], ['failed', true]);
});

test('the workflow names its repository, file and branch, and API calls carry the token', async () => {
	assert.deepEqual(workflow, {
		repository: 'owner/app',
		path: '.github/workflows/checks.yml',
		branch: 'main'
	});
	for (const invalid of ['', 'owner/app/.github/workflows/checks.yml@refs/tags/v1', 'checks.yml'])
		assert.throws(() => parseWorkflow(invalid));
	const requests = [];
	const github = githubClient('owner/app', 'secret', async (url, options) => {
		requests.push([url, options.headers.Authorization]);
		return Response.json({ ok: true });
	});
	assert.deepEqual(await github('branches/main'), { ok: true });
	assert.deepEqual(requests, [
		['https://api.github.com/repos/owner/app/branches/main', 'Bearer secret']
	]);
	const failing = githubClient(
		'owner/app',
		'secret',
		async () => new Response('', { status: 404 })
	);
	await assert.rejects(failing('actions/runs/1'), /GitHub answered 404 for actions\/runs\/1/);
});

test('an artifact unpacks to the archive path deploy-release.sh accepts', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'kaordo-artifact-'));
	try {
		await writeFile(join(directory, 'release.json'), JSON.stringify(release));
		await writeFile(join(directory, 'release.tar.gz'), archive);
		const packed = spawnSync('zip', [
			'-q',
			'-j',
			join(directory, 'artifact.zip'),
			join(directory, 'release.json'),
			join(directory, 'release.tar.gz')
		]);
		assert.equal(packed.status, 0, String(packed.stderr));
		const unpacked = await unpackRelease(await readFile(join(directory, 'artifact.zip')));
		try {
			assert.deepEqual(unpacked.release, release);
			assert.equal(unpacked.archive, `/tmp/kaordo-${release.id}-full.tar.gz`);
			assert.deepEqual(await readFile(unpacked.archive), archive);
		} finally {
			await rm(unpacked.archive, { force: true });
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
