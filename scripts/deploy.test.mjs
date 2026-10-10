// Exercises which GitHub Actions runs may replace production and how their releases are verified

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDeploymentReport } from '../deploy/nixos/deployment-report.mjs';
import { monitorDeployment, deploymentSummary, productionRequest } from './watch-deployment.mjs';
import {
	deploy,
	githubClient,
	parseWorkflow,
	unpackRelease,
	downloadArtifact
} from '../deploy/nixos/deploy.mjs';

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
			path: '.github/workflows/checks.yml',
			run_attempt: 1
		},
		'actions/runs/7/jobs?filter=latest&per_page=100': {
			jobs: [{ id: 1, name: 'checks', conclusion: 'success', head_sha: revision }]
		},
		'branches/main': { commit: { sha: revision } },
		[`compare/${active}...${revision}`]: { status: 'ahead' },
		'actions/runs/7/artifacts?name=production-release': {
			artifacts: [
				{
					id: 9,
					name: 'production-release',
					expired: false,
					size_in_bytes: zip.length,
					digest: `sha256:${sha256(zip)}`
				}
			]
		},
		'actions/artifacts/9/zip': zip,
		...changes.github
	};
	const events = [];
	const report = {
		entry: { rollback: 'not_needed' },
		report: async (change) => {
			Object.assign(report.entry, change);
		},
		phase: async (phase, message) => {
			Object.assign(report.entry, { phase, message });
			events.push(`phase ${phase}`);
		}
	};
	const dependencies = {
		workflow,
		github: async (path) => {
			events.push(path);
			if (!(path in answers)) throw new Error(`unexpected ${path}`);
			return typeof answers[path] === 'function' ? answers[path]() : answers[path];
		},
		production: async () => ({
			sourceCommit: active,
			origin: 'https://example.test',
			realm: 'app',
			...changes.production
		}),
		download: async (artifact) => {
			const path = join(await scratch, `artifact-${events.length}.zip`);
			await downloadArtifact(
				async (path) => new Response(answers[path]),
				artifact,
				path,
				async () => {}
			);
			return path;
		},
		verify: changes.verify ?? (async () => events.push('verify active')),
		unpack: async () => {
			const path = join(await scratch, `release-${events.length}.tar.gz`);
			await writeFile(path, changes.archive ?? archive);
			return { release: { ...release, ...changes.release }, archive: path };
		},
		install: async (installed, path, production) => {
			events.push(`install ${installed.id} ${production.realm}`);
			if (changes.exit === 1) report.entry.hostChanged = false;
			return changes.exit ?? 0;
		},
		report
	};
	return { events, run: () => deploy(7, dependencies) };
}

test('the trusted branch head installs its own release on top of production', async () => {
	const { events, run } = scenario();
	const result = await run();
	assert.equal(result.state, 'succeeded');
	assert.equal(result.revision, revision);
	assert.equal(events[0], 'phase authorization');
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
					run_attempt: 1,
					...details
				}
			}
		});
		assert.equal((await run()).state, 'failed');
		assert.ok(!events.some((event) => event.includes('artifacts')));
	}
	const { events, run } = scenario({
		github: {
			'actions/runs/7/jobs?filter=latest&per_page=100': {
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
		await run().then(
			(result) => assert.equal(result.state, 'failed', JSON.stringify(changes)),
			(error) => assert.match(error.message, /download failed/)
		);
		assert.ok(!events.some((event) => event.startsWith('install')));
	}
});

test('a rejected release keeps the previous one and a failed rollback is marked for an operator', async () => {
	const rejected = await scenario({ exit: 1 }).run();
	assert.deepEqual([rejected.state, rejected.rollbackFailed], ['failed', undefined]);
	assert.match(rejected.message, /before activation/);
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
	await assert.rejects(failing('actions/runs/1'), /GitHub answered HTTP 404 for actions\/runs\/1/);
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
		const output = join(directory, 'unpacked');
		const unpacked = await unpackRelease(join(directory, 'artifact.zip'), output);
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

test('a slow stream reports bytes and completes without buffering the artifact in memory', async () => {
	const path = join(await scratch, 'slow.zip');
	const progress = [];
	let sent = 0;
	const bytes = Buffer.from('slow verified release');
	const body = new ReadableStream({
		async pull(controller) {
			await new Promise((resolve) => setTimeout(resolve, 15));
			if (sent < bytes.length) controller.enqueue(bytes.subarray(sent++, sent));
			else controller.close();
		}
	});
	await downloadArtifact(
		async () => new Response(body),
		{ id: 1, size_in_bytes: bytes.length, digest: `sha256:${sha256(bytes)}` },
		path,
		async (entry) => progress.push(entry),
		{ idleMs: 100, deadlineMs: 2000 }
	);
	assert.deepEqual(await readFile(path), bytes);
	assert.equal(progress[0].receivedBytes, 0);
	assert.equal(progress.at(-1).receivedBytes, bytes.length);
});

test('a stalled stream fails with the received-byte context and removes the partial artifact', async () => {
	const path = join(await scratch, 'stalled.zip');
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(Buffer.from('partial'));
		}
	});
	await assert.rejects(
		downloadArtifact(
			async () => new Response(body),
			{ id: 1, size_in_bytes: 100, digest: `sha256:${'a'.repeat(64)}` },
			path,
			async () => {},
			{ idleMs: 30, deadlineMs: 1000 }
		),
		/failed after 7 of 100 bytes:.*stopped receiving/
	);
	await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('download integrity errors cannot be retried into an accepted release', async () => {
	const path = join(await scratch, 'bad.zip');
	await assert.rejects(
		downloadArtifact(
			async () => new Response('changed'),
			{ id: 1, size_in_bytes: 7, digest: `sha256:${'a'.repeat(64)}` },
			path,
			async () => {}
		),
		(error) => error.retryable === false && /digest/.test(error.message)
	);
	await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('the durable journal orders concurrent updates, limits output and preserves the failed phase through rollback', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'kaordo-report-test-'));
	try {
		const report = await createDeploymentReport(directory, { run: 7, attempt: 2, revision }, [
			'private-value'
		]);
		await report.phase('activation', 'Activating.');
		await Promise.all(
			Array.from({ length: 310 }, (_, index) =>
				report.output(`line ${index} private-value Bearer private-token`)
			)
		);
		await report.output('KAORDO_DEPLOY_PHASE=rollback Restoring.');
		// stderr may arrive after the next stdout phase; the installer names the original failure
		await report.output(
			'KAORDO_DEPLOY_ERROR=Step activation failed at installer line 100 with exit status 1.'
		);
		await report.output('KAORDO_DEPLOY_ROLLBACK=succeeded');
		await report.report({ state: 'failed', message: 'Previous release restored.' });
		const persisted = JSON.parse(await readFile(join(directory, '7.json'), 'utf8'));
		assert.equal(persisted.events.length, 300);
		assert.equal(persisted.error.phase, 'activation');
		assert.equal(persisted.rollback, 'succeeded');
		assert.equal(persisted.hostChanged, false);
		assert.ok(persisted.finishedAt);
		assert.ok(!JSON.stringify(persisted).includes('private-value'));
		assert.ok(!JSON.stringify(persisted).includes('private-token'));
		for (let index = 1; index < persisted.events.length; index++)
			assert.equal(persisted.events[index].sequence, persisted.events[index - 1].sequence + 1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('the monitor reconnects after API restarts and reports the server failure and rollback', async () => {
	let now = 0;
	let call = 0;
	const methods = [];
	const logs = [];
	const summaries = [];
	const base = {
		run: 7,
		attempt: 1,
		revision,
		state: 'deploying',
		phase: 'activation',
		updatedAt: '2026-10-10T12:00:00Z'
	};
	const result = await monitorDeployment({
		run: 7,
		attempt: 1,
		pollMs: 10,
		timeoutMs: 1000,
		reconnectMs: 100,
		now: () => now,
		sleep: async (ms) => {
			now += ms;
		},
		log: (value) => logs.push(value),
		summary: async (report, elapsed, error) =>
			summaries.push(deploymentSummary(report, 'https://example.test', elapsed, error)),
		request: async (method) => {
			methods.push(method);
			if (++call === 1) return base;
			if (call <= 4) throw Object.assign(new Error('HTTP 503'), { transient: true });
			return {
				...base,
				state: 'failed',
				phase: 'rollback',
				message: 'Activation failed; previous release restored.',
				rollback: 'succeeded',
				error: { phase: 'activation', message: 'The service did not become ready.' }
			};
		}
	});
	assert.deepEqual(methods, ['POST', 'GET', 'GET', 'GET', 'GET']);
	assert.equal(result.state, 'failed');
	assert.ok(logs.some((line) => line.includes('reconnected')));
	assert.match(summaries.at(-1), /Failed phase: activation/);
	assert.match(summaries.at(-1), /previous release restored/);
});

test('a lost acceptance response repeats only the same attempt and permanent authentication failures stop immediately', async () => {
	let now = 0;
	let calls = 0;
	const methods = [];
	const result = await monitorDeployment({
		run: 7,
		attempt: 2,
		pollMs: 1,
		now: () => now,
		sleep: async (ms) => {
			now += ms;
		},
		log: () => {},
		request: async (method) => {
			methods.push(method);
			if (++calls === 1) throw Object.assign(new Error('Connection dropped'), { transient: true });
			return { run: 7, attempt: 2, state: 'succeeded', phase: 'complete', message: 'Verified.' };
		}
	});
	assert.equal(result.state, 'succeeded');
	assert.deepEqual(methods, ['POST', 'POST']);
	await assert.rejects(
		monitorDeployment({
			run: 7,
			attempt: 2,
			request: async () => {
				throw Object.assign(new Error('HTTP 401'), { transient: false });
			}
		}),
		/401/
	);
});

test('a monitoring deadline remains distinct from an installation failure', async () => {
	let now = 0;
	let last;
	await assert.rejects(
		monitorDeployment({
			run: 7,
			attempt: 1,
			timeoutMs: 30,
			pollMs: 10,
			log: () => {},
			now: () => now,
			sleep: async (ms) => {
				now += ms;
			},
			request: async () => ({ run: 7, attempt: 1, state: 'deploying', phase: 'build' }),
			summary: async (report, elapsed, error) => {
				last = { report, error };
			}
		}),
		/server may still be deploying/
	);
	assert.equal(last.report.state, 'deploying');
	assert.match(last.error, /deadline/);
});

test('status requests refresh OIDC and classify only transient HTTP failures for reconnection', async () => {
	const calls = [];
	const environment = {
		ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.test/token?run=7',
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token'
	};
	let status = 503;
	const request = productionRequest('https://example.test', environment, async (url, options) => {
		calls.push([String(url), options.headers.Authorization]);
		if (String(url).startsWith('https://oidc.example.test'))
			return Response.json({ value: 'minted-token' });
		return new Response('', { status });
	});
	await assert.rejects(request('GET', '/7'), (error) => error.transient === true);
	status = 403;
	await assert.rejects(request('GET', '/7'), (error) => error.transient === false);
	assert.equal(calls.length, 4);
	assert.ok(calls[0][0].includes('audience=https%3A%2F%2Fexample.test'));
	assert.equal(calls[1][1], 'Bearer minted-token');
});

test('a deployment-only retry reuses the latest gate while an old successful gate cannot hide a newer failed one', async () => {
	const retry = scenario({
		github: {
			'actions/runs/7/jobs?filter=latest&per_page=100': {
				jobs: [{ name: 'Production deployment', id: 3 }]
			},
			'actions/runs/7/jobs?filter=all&per_page=100': {
				jobs: [{ id: 1, name: 'checks', conclusion: 'success', head_sha: revision }]
			}
		}
	});
	assert.equal((await retry.run()).state, 'succeeded');
	const rejected = scenario({
		github: {
			'actions/runs/7/jobs?filter=latest&per_page=100': {
				jobs: [
					{ id: 2, name: 'checks', conclusion: 'failure', head_sha: revision },
					{ id: 1, name: 'checks', conclusion: 'success', head_sha: revision }
				]
			}
		}
	});
	assert.equal((await rejected.run()).state, 'failed');
	assert.ok(!rejected.events.some((entry) => entry.includes('artifacts')));
	const paginated = scenario({
		github: {
			'actions/runs/7/jobs?filter=latest&per_page=100': {
				jobs: [{ name: 'Production deployment', id: 4 }]
			},
			'actions/runs/7/jobs?filter=all&per_page=100': {
				total_count: 2,
				jobs: [{ id: 1, name: 'checks', conclusion: 'success', head_sha: revision }]
			},
			'actions/runs/7/jobs?filter=all&per_page=100&page=2': {
				jobs: [{ id: 2, name: 'checks', conclusion: 'failure', head_sha: revision }]
			}
		}
	});
	assert.equal((await paginated.run()).state, 'failed');
	assert.ok(!paginated.events.some((entry) => entry.includes('artifacts')));
});

test('main moving during download supersedes the artifact before any installer starts', async () => {
	let reads = 0;
	const fixture = scenario({
		github: {
			'branches/main': () => ({ commit: { sha: ++reads === 1 ? revision : 'c'.repeat(40) } })
		}
	});
	assert.equal((await fixture.run()).state, 'superseded');
	assert.ok(!fixture.events.some((event) => event.startsWith('install')));
});

test('an already installed revision cannot report success when live verification fails', async () => {
	const fixture = scenario({
		production: { sourceCommit: revision },
		verify: async () => {
			throw new Error('Installed release differs from its manifest.');
		}
	});
	await assert.rejects(fixture.run(), /differs from its manifest/);
	assert.ok(!fixture.events.some((event) => event.startsWith('install')));
});
