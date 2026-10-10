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
		run: (action = 'poll') =>
			spawnSync(
				process.execPath,
				['--import', join(root, 'fetch.mjs'), join(source, 'cd.mjs'), action],
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

test('bootstrap installs every file the controller and its units run, as one release set', async () => {
	const read = (name) => readFile(new URL(`../deploy/nixos/${name}`, import.meta.url), 'utf8');
	const [bootstrap, controller, units] = await Promise.all(
		['bootstrap-cd.sh', 'cd.mjs', 'cd.nix'].map(read)
	);
	const installed = bootstrap.match(/^for file in (.+); do$/m)[1].split(' ');
	const activation = controller
		.match(/for \(const file of \[([^\]]+)\]\)/)[1]
		.match(/'[^']+'/g)
		.map((name) => name.slice(1, -1));
	const referenced = [
		...`${controller}\n${units}`.matchAll(/\/etc\/nixos\/deploy\/nixos\/([\w.-]+)/g)
	].map(([, name]) => name);
	assert.ok(activation.includes('deploy-release.sh'));
	for (const file of [...activation, ...referenced])
		assert.ok(installed.includes(file), `bootstrap installs ${file}`);
});

test('a failure stops mattering once production runs main or a newer main supersedes it', async () => {
	for (const productionAtMain of [false, true]) {
		const fixture = await pollFixture({ conclusion: 'failure' });
		try {
			const stateFile = join(fixture.stateRoot, 'state.json');
			await writeFile(
				stateFile,
				JSON.stringify({
					baselineCommit: 'd'.repeat(40),
					activeCommit: active,
					phase: 'failed',
					failedAttempt: `${productionAtMain ? revision : 'f'.repeat(40)}:1:1`,
					error: 'Synthetic failure'
				})
			);
			if (productionAtMain)
				await writeFile(
					join(fixture.root, 'data/releases/current/manifest.json'),
					JSON.stringify({ sourceCommit: revision, workingTreeDirty: false })
				);
			assert.equal(fixture.run().status, 0);
			const state = JSON.parse(await readFile(stateFile));
			assert.equal(state.phase, 'idle');
			assert.equal(state.error, undefined);
		} finally {
			await fixture.close();
		}
	}
});

// Prepares the state a poll leaves for the transient activation unit
async function activationFixture({ lockHeld = false, deployStatus = 0 } = {}) {
	const fixture = await pollFixture();
	const source = join(fixture.root, 'controller');
	const data = join(fixture.root, 'data');
	await rename(join(source, 'checkpoint.mjs'), join(source, 'checkpoint-real.mjs'));
	await writeFile(
		join(source, 'checkpoint.mjs'),
		`import { appendFileSync } from 'node:fs';
export { command } from './checkpoint-real.mjs';
export async function checkpoint() { appendFileSync(process.env.FIXTURE_ROOT + '/events', 'checkpoint\\n'); }
`
	);
	const activation = join(fixture.stateRoot, 'activation');
	await mkdir(activation);
	await cp(join(data, 'cd-build/candidate/release.tar.gz'), join(activation, 'release.tar.gz'));
	await writeFile(join(fixture.root, 'manifest.json'), JSON.stringify(manifest));
	// A successful release switches the active manifest, as deploy-release.sh does
	await writeFile(
		join(activation, 'deploy-release.sh'),
		`echo deploy >> "$FIXTURE_ROOT/events"
[[ ${deployStatus} -ne 0 ]] || cp "$FIXTURE_ROOT/manifest.json" "$FIXTURE_ROOT/data/releases/current/manifest.json"
exit ${deployStatus}
`
	);
	await mkdir(join(data, lockHeld ? 'tmp/production-deploy.lock' : 'tmp'), { recursive: true });
	await writeFile(
		join(fixture.stateRoot, 'state.json'),
		JSON.stringify({
			baselineCommit: 'd'.repeat(40),
			activeCommit: active,
			phase: 'activating',
			candidate: JSON.parse(await readFile(join(data, 'cd-build/candidate/release.json'))),
			attempt: `${revision}:${run.id}:${run.run_attempt}`
		})
	);
	return {
		...fixture,
		state: async () => JSON.parse(await readFile(join(fixture.stateRoot, 'state.json'))),
		events: async () => (await readFile(join(fixture.root, 'events'), 'utf8')).split('\n'),
		locked: () =>
			stat(join(data, 'tmp/production-deploy.lock')).then(
				() => true,
				() => false
			)
	};
}

test('a verified activation takes a checkpoint, deploys and records production at main', async () => {
	const fixture = await activationFixture();
	try {
		const result = fixture.run('activate');
		assert.equal(result.status, 0, result.stderr);
		const state = await fixture.state();
		assert.deepEqual([state.phase, state.activeCommit], ['idle', revision]);
		const events = await fixture.events();
		assert.ok(events.indexOf('checkpoint') < events.indexOf('deploy'));
		assert.equal(await fixture.locked(), false, 'The activation releases its host lock');
	} finally {
		await fixture.close();
	}
});

test('a held host lock fails the attempt before any checkpoint instead of rebuilding it', async () => {
	const fixture = await activationFixture({ lockHeld: true });
	try {
		assert.equal(fixture.run('activate').status, 1);
		const state = await fixture.state();
		assert.equal(state.phase, 'failed');
		assert.match(state.error, /holds the host lock/);
		assert.equal(state.failedAttempt, `${revision}:${run.id}:${run.run_attempt}`);
		assert.doesNotMatch((await fixture.events()).join('\n'), /checkpoint|deploy/);
		assert.equal(await fixture.locked(), true, 'Another deployment keeps its lock');
		// The same CI attempt is not built again
		assert.equal(fixture.run().status, 0);
		assert.doesNotMatch((await fixture.events()).join('\n'), /systemctl:start|systemd-run:/);
	} finally {
		await fixture.close();
	}
});

test('a rejected release fails the attempt and a failed rollback halts deployment until resumed', async () => {
	for (const [deployStatus, phase, error] of [
		[1, 'failed', /keeps the previous release/],
		[70, 'halted', /rollback needs operator attention/]
	]) {
		const fixture = await activationFixture({ deployStatus });
		try {
			assert.equal(fixture.run('activate').status, 1);
			const state = await fixture.state();
			assert.equal(state.phase, phase);
			assert.match(state.error, error);
			assert.equal(state.activeCommit, active);
			assert.equal(await fixture.locked(), false);
			if (phase !== 'halted') continue;
			const before = (await fixture.events()).length;
			assert.equal(fixture.run().status, 0);
			assert.equal((await fixture.events()).length, before, 'A halted host polls nothing');
			assert.equal(fixture.run('resume').status, 0);
			assert.deepEqual(await fixture.state(), {
				baselineCommit: 'd'.repeat(40),
				activeCommit: active,
				phase: 'idle'
			});
		} finally {
			await fixture.close();
		}
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
