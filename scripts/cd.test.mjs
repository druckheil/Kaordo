// Exercises deployment trust, stale revision rejection and private checkpoint recovery

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	readdir,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	repository,
	requireValidationJobs,
	selectRun,
	validateCandidate,
	validationJobs
} from '../deploy/nixos/cd.mjs';
import { checkpoint } from '../deploy/nixos/checkpoint.mjs';

const revision = 'a'.repeat(40);
const active = 'b'.repeat(40);
const run = {
	id: 123,
	run_number: 10,
	run_attempt: 1,
	workflow_id: repository.workflow,
	head_sha: revision,
	head_branch: 'main',
	event: 'push',
	status: 'completed',
	conclusion: 'success',
	path: '.github/workflows/checks.yml',
	repository: { id: repository.id },
	head_repository: { id: repository.id },
	html_url: 'https://github.com/druckheil/Kaordo/actions/runs/123'
};
const jobs = validationJobs.map((name) => ({ name, status: 'completed', conclusion: 'success' }));

test('deployment requires a successful main push from the trusted workflow and repository', () => {
	assert.equal(selectRun([run], revision), run);
	for (const difference of [
		{ event: 'pull_request' },
		{ event: 'workflow_dispatch' },
		{ head_branch: 'scope-0.0.4' },
		{ head_sha: active },
		{ head_repository: { id: 123 } },
		{ workflow_id: 123 },
		{ path: '.github/workflows/untrusted.yml' }
	])
		assert.throws(() => selectRun([{ ...run, ...difference }], revision), /trusted main push/);
	for (const conclusion of ['failure', 'cancelled', 'skipped'])
		assert.equal(selectRun([{ ...run, conclusion }], revision), null);
	assert.equal(selectRun([{ ...run, status: 'in_progress' }], revision), null);
	assert.equal(
		selectRun([run, { ...run, id: 124, run_number: 11, conclusion: 'failure' }], revision),
		null
	);
});

test('the deployment gate rejects a missing, skipped, duplicate or failed validation layer', () => {
	requireValidationJobs(jobs);
	assert.throws(() =>
		requireValidationJobs(jobs.filter(({ name }) => name !== 'Production release payload'))
	);
	assert.throws(() => requireValidationJobs([...jobs, jobs[0]]));
	for (const name of validationJobs) {
		for (const conclusion of ['failure', 'cancelled', 'skipped']) {
			assert.throws(() =>
				requireValidationJobs(jobs.map((job) => (job.name === name ? { ...job, conclusion } : job)))
			);
		}
	}
});

const candidate = {
	id: `v0.0.4-${revision.slice(0, 12)}-20261010T120000Z`,
	hash: 'c'.repeat(64),
	sourceCommit: revision
};
const manifest = {
	format: 1,
	sourceCommit: revision,
	release: candidate.id,
	workingTreeDirty: false,
	origin: 'https://kaordo.link',
	realm: 'kaordo'
};

test('candidate identity ties the archive, clean Git revision and public deployment target together', () => {
	validateCandidate(candidate, manifest, revision);
	for (const difference of [
		{ sourceCommit: active },
		{ workingTreeDirty: true },
		{ origin: 'http://localhost:8765' },
		{ release: 'other' }
	]) {
		assert.throws(() => validateCandidate(candidate, { ...manifest, ...difference }, revision));
	}
	assert.throws(() =>
		validateCandidate({ ...candidate, id: candidate.id + '-dirty' }, manifest, revision)
	);
});

async function pollFixture({ stale = false, conclusion = 'success' } = {}) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'kaordo-cd-')));
	const stateRoot = join(root, 'state');
	const dataRoot = join(root, 'data');
	const commands = join(root, 'commands');
	const source = join(root, 'controller');
	await Promise.all([
		mkdir(stateRoot),
		mkdir(commands),
		mkdir(source),
		mkdir(join(dataRoot, 'releases/current'), { recursive: true }),
		mkdir(join(dataRoot, 'cd-build/candidate'), { recursive: true })
	]);
	await writeFile(
		join(stateRoot, 'state.json'),
		JSON.stringify({ baselineCommit: 'd'.repeat(40), activeCommit: active, phase: 'idle' })
	);
	await writeFile(
		join(dataRoot, 'releases/current/manifest.json'),
		JSON.stringify({ sourceCommit: active, workingTreeDirty: false })
	);
	const bundle = join(root, 'bundle');
	await mkdir(bundle);
	await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest));
	const archive = join(dataRoot, 'cd-build/candidate/release.tar.gz');
	assert.equal(spawnSync('tar', ['-czf', archive, '-C', bundle, 'manifest.json']).status, 0);
	await writeFile(
		join(dataRoot, 'cd-build/candidate/release.json'),
		JSON.stringify({
			...candidate,
			hash: createHash('sha256')
				.update(await readFile(archive))
				.digest('hex')
		})
	);
	await cp(
		new URL('../deploy/nixos/checkpoint.mjs', import.meta.url),
		join(source, 'checkpoint.mjs')
	);
	await cp(
		new URL('../deploy/nixos/deploy-release.sh', import.meta.url),
		join(source, 'deploy-release.sh')
	);
	let controller = await readFile(new URL('../deploy/nixos/cd.mjs', import.meta.url), 'utf8');
	controller = controller
		.replaceAll('/var/lib/kaordo-cd', stateRoot)
		.replaceAll('/srv/kaordo', dataRoot);
	await writeFile(join(source, 'cd.mjs'), controller);
	await writeFile(
		join(root, 'evidence.json'),
		JSON.stringify({ workflow_runs: [{ ...run, conclusion }], jobs, total_count: jobs.length })
	);
	await writeFile(
		join(root, 'fetch.mjs'),
		`import{readFileSync,appendFileSync}from'node:fs';globalThis.fetch=async()=>{appendFileSync(process.env.FIXTURE_ROOT+'/events','fetch\\n');return Response.json(JSON.parse(readFileSync(process.env.FIXTURE_ROOT+'/evidence.json')));};`
	);
	const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),root=process.env.FIXTURE_ROOT,name=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(root+'/events',name+':'+args.join(' ')+'\\n');
if(name==='git') { const changed=fs.existsSync(root+'/built')&&process.env.FIXTURE_STALE==='1'; console.log((changed?'e':'a').repeat(40)+'\\trefs/heads/main'); }
if(name==='systemctl'&&args[0]==='start')fs.writeFileSync(root+'/built','done');
`;
	for (const name of ['git', 'systemctl', 'systemd-run']) {
		await writeFile(join(commands, name), stub);
		await chmod(join(commands, name), 0o755);
	}
	return {
		root,
		stateRoot,
		run: () =>
			spawnSync(
				process.execPath,
				['--import', join(root, 'fetch.mjs'), join(source, 'cd.mjs'), 'poll'],
				{
					encoding: 'utf8',
					env: {
						...process.env,
						PATH: `${commands}:${process.env.PATH}`,
						FIXTURE_ROOT: root,
						FIXTURE_STALE: stale ? '1' : '0'
					},
					timeout: 10_000
				}
			),
		close: () => rm(root, { recursive: true, force: true })
	};
}

test('a verified main candidate queues a durable activation and a newer main cancels preparation', async () => {
	for (const stale of [false, true]) {
		const fixture = await pollFixture({ stale });
		try {
			const result = fixture.run();
			assert.equal(result.status, 0, result.stderr);
			const events = await readFile(join(fixture.root, 'events'), 'utf8');
			assert.equal(events.includes('systemd-run:'), !stale);
			const state = JSON.parse(await readFile(join(fixture.stateRoot, 'state.json')));
			assert.equal(state.phase, stale ? 'idle' : 'activating');
			assert.equal(
				state.activeCommit,
				active,
				'Preparing a candidate never marks production deployed'
			);
		} finally {
			await fixture.close();
		}
	}
});

test('failed main checks never start a build or touch the active production revision', async () => {
	const fixture = await pollFixture({ conclusion: 'failure' });
	try {
		assert.equal(fixture.run().status, 0);
		assert.doesNotMatch(
			await readFile(join(fixture.root, 'events'), 'utf8'),
			/systemctl:start|systemd-run:/
		);
		assert.equal(
			JSON.parse(await readFile(join(fixture.stateRoot, 'state.json'))).activeCommit,
			active
		);
	} finally {
		await fixture.close();
	}
});

test('a failed deployment backs off evidence queries and accepts only a new successful attempt', async () => {
	const fixture = await pollFixture();
	try {
		const stateFile = join(fixture.stateRoot, 'state.json');
		await writeFile(
			stateFile,
			JSON.stringify({
				baselineCommit: 'd'.repeat(40),
				activeCommit: active,
				phase: 'failed',
				failedAttempt: `${revision}:${run.id}:${run.run_attempt}`,
				lastEvidenceAt: 0
			})
		);
		assert.equal(fixture.run().status, 0);
		const checked = JSON.parse(await readFile(stateFile));
		assert.ok(Date.now() - checked.lastEvidenceAt < 10_000);
		assert.equal(fixture.run().status, 0);
		const events = await readFile(join(fixture.root, 'events'), 'utf8');
		assert.equal(events.split('\n').filter((event) => event === 'fetch').length, 2);
		assert.doesNotMatch(events, /systemctl:start|systemd-run:/);
		await writeFile(
			stateFile,
			JSON.stringify({ ...checked, lastEvidenceAt: Date.now() - 600_001 })
		);
		await writeFile(
			join(fixture.root, 'evidence.json'),
			JSON.stringify({
				workflow_runs: [{ ...run, run_attempt: 2 }],
				jobs,
				total_count: jobs.length
			})
		);
		assert.equal(fixture.run().status, 0);
		assert.equal(JSON.parse(await readFile(stateFile)).phase, 'activating');
	} finally {
		await fixture.close();
	}
});

test('commissioning CD cannot deploy the older recorded main baseline', async () => {
	const fixture = await pollFixture();
	try {
		await writeFile(
			join(fixture.stateRoot, 'state.json'),
			JSON.stringify({ baselineCommit: revision, activeCommit: active, phase: 'idle' })
		);
		assert.equal(fixture.run().status, 0);
		assert.doesNotMatch(
			await readFile(join(fixture.root, 'events'), 'utf8'),
			/systemctl:start|systemd-run:/
		);
		assert.equal(
			JSON.parse(await readFile(join(fixture.stateRoot, 'state.json'))).activeCommit,
			active
		);
	} finally {
		await fixture.close();
	}
});

async function checkpointFixture(failRestore = false) {
	const root = await mkdtemp(join(tmpdir(), 'kaordo-checkpoint-'));
	const dataRoot = join(root, 'data');
	const stateRoot = join(root, 'state');
	await Promise.all([
		mkdir(join(dataRoot, 'secrets'), { recursive: true }),
		mkdir(join(dataRoot, 'postgresql'), { recursive: true }),
		mkdir(stateRoot)
	]);
	const events = [];
	let staging;
	const execute = async (program, args, options) => {
		events.push([program, ...args]);
		assert.equal(
			options.quiet,
			true,
			'Production backup commands must not print data or credentials'
		);
		if (program === 'runuser' && args[3] === 'pg_dump')
			await writeFile(args[args.indexOf('--file') + 1], 'synthetic-private-dump');
		if (program === 'mv') await rename(args[0], args[1]);
		if (program === 'btrfs' && args[1] === 'snapshot') await mkdir(args.at(-1));
		if (program === 'btrfs' && args[1] === 'delete') await rm(args.at(-1), { recursive: true });
		if (program === 'restic' && args[0] === 'init')
			await writeFile(join(dataRoot, 'deployment-backups/config'), 'encrypted-config');
		if (program === 'restic' && args[0] === 'backup') staging = args.at(-3);
		if (program === 'restic' && args[0] === 'snapshots')
			return JSON.stringify([{ id: 'f'.repeat(64) }]);
		if (program === 'restic' && args[0] === 'restore')
			await cp(staging, join(args[args.indexOf('--target') + 1], staging.slice(1)), {
				recursive: true
			});
		return '';
	};
	const restore = async (path, name) => {
		events.push(['restore', name]);
		assert.equal(await readFile(path, 'utf8'), 'synthetic-private-dump');
		if (failRestore) throw new Error('Synthetic restore rejected');
	};
	return {
		root,
		dataRoot,
		stateRoot,
		events,
		execute,
		restore,
		waitIdentity: async () => {},
		close: () => rm(root, { recursive: true, force: true })
	};
}

test('a checkpoint freezes matching data, encrypts it and verifies disposable restores with private files', async () => {
	const fixture = await checkpointFixture();
	try {
		await checkpoint(revision, fixture);
		const events = fixture.events.map((event) => event.join(' '));
		const stop = events.findIndex((event) => event === 'systemctl stop kerno nodo keycloak');
		const snapshot = events.findIndex((event) => event.startsWith('btrfs subvolume snapshot -r'));
		const resume = events.findIndex((event) => event === 'systemctl start nodo kerno');
		const backup = events.findIndex((event) => event.startsWith('restic backup'));
		assert.ok(stop < snapshot && snapshot < resume && resume < backup);
		assert.equal(events.filter((event) => event.startsWith('restore ')).length, 2);
		assert.equal(
			events.filter((event) => event.includes('dropdb --if-exists kaordo_cd_verify_')).length,
			2
		);
		assert.equal(
			(await stat(join(fixture.dataRoot, 'secrets/deployment-backup-password'))).mode & 0o777,
			0o600
		);
		assert.equal((await stat(join(fixture.stateRoot, 'checkpoint.json'))).mode & 0o777, 0o600);
		assert.deepEqual(
			(await readdir(fixture.stateRoot)).filter((path) => path.startsWith('cd-')),
			[]
		);
	} finally {
		await fixture.close();
	}
});

test('a failed restore blocks deployment, drops the disposable database and leaves services running', async () => {
	const fixture = await checkpointFixture(true);
	try {
		await assert.rejects(checkpoint(revision, fixture), /Synthetic restore rejected/);
		const events = fixture.events.map((event) => event.join(' '));
		assert.ok(events.includes('systemctl start nodo kerno'));
		assert.equal(
			events.filter((event) => event.includes('dropdb --if-exists kaordo_cd_verify_')).length,
			1
		);
		assert.ok(events.some((event) => event.startsWith('btrfs subvolume delete')));
		assert.deepEqual(
			(await readdir(fixture.stateRoot)).filter((path) => path.startsWith('cd-')),
			[]
		);
		await assert.rejects(readFile(join(fixture.stateRoot, 'checkpoint.json')), { code: 'ENOENT' });
	} finally {
		await fixture.close();
	}
});
