// Selects verified main runs and coordinates isolated builds and durable host activation

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkpoint, command } from './checkpoint.mjs';

export const repository = { name: 'druckheil/Kaordo', id: 1333035875, workflow: 370320419 };
export const validationJobs = [
	'Frontend and unit tests',
	'Static app artifact',
	'Production release payload',
	'Browser fixtures and accessibility (1/3)',
	'Browser fixtures and accessibility (2/3)',
	'Browser fixtures and accessibility (3/3)',
	'Go services and PostgreSQL',
	'Identity, product and recovery journeys',
	'Dependency advisories',
	'checks'
];
const stateRoot = '/var/lib/kaordo-cd';
const buildRoot = '/srv/kaordo/cd-build';
const stateFile = join(stateRoot, 'state.json');
const revisionPattern = /^[a-f0-9]{40}$/;

export function selectRun(runs, revision) {
	if (!revisionPattern.test(revision)) throw new Error('Invalid main revision.');
	const run = [...runs].sort(
		(a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt
	)[0];
	if (!run) return null;
	if (
		run.head_sha !== revision ||
		run.head_branch !== 'main' ||
		run.event !== 'push' ||
		run.repository?.id !== repository.id ||
		run.head_repository?.id !== repository.id ||
		run.workflow_id !== repository.workflow ||
		run.path !== '.github/workflows/checks.yml'
	) {
		throw new Error('Workflow evidence does not identify the trusted main push.');
	}
	return run.status === 'completed' && run.conclusion === 'success' ? run : null;
}

export function requireValidationJobs(jobs) {
	const names = jobs.map(({ name }) => name);
	if (
		new Set(names).size !== names.length ||
		validationJobs.some((name) => !names.includes(name)) ||
		jobs.some(({ status, conclusion }) => status !== 'completed' || conclusion !== 'success')
	) {
		throw new Error('Every required validation job must have succeeded without skips.');
	}
}

export function validateCandidate(candidate, manifest, revision) {
	if (
		!revisionPattern.test(revision) ||
		candidate.sourceCommit !== revision ||
		!/^v\d+\.\d+\.\d+-[a-f0-9]{12}-\d{8}T\d{6}Z$/.test(candidate.id) ||
		!candidate.id.includes(`-${revision.slice(0, 12)}-`) ||
		!/^[a-f0-9]{64}$/.test(candidate.hash) ||
		manifest.format !== 1 ||
		manifest.sourceCommit !== revision ||
		manifest.workingTreeDirty !== false ||
		manifest.release !== candidate.id ||
		manifest.origin !== 'https://kaordo.link' ||
		manifest.realm !== 'kaordo'
	) {
		throw new Error('Candidate must match the clean, tested production revision.');
	}
}

async function api(path) {
	const response = await fetch(`https://api.github.com/repos/${repository.name}/${path}`, {
		headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
		signal: AbortSignal.timeout(15_000),
		redirect: 'error'
	});
	if (!response.ok) throw new Error(`GitHub evidence request failed (${response.status}).`);
	return response.json();
}

async function mainRevision() {
	const refs = await command(
		'git',
		['ls-remote', '--refs', `https://github.com/${repository.name}.git`, 'refs/heads/main'],
		{ capture: true }
	);
	const match = refs.match(/^([a-f0-9]{40})\s+refs\/heads\/main$/);
	if (!match) throw new Error('GitHub did not return one main revision.');
	return match[1];
}

async function evidence(revision) {
	const response = await api(
		`actions/workflows/checks.yml/runs?branch=main&event=push&head_sha=${revision}&per_page=10`
	);
	const run = selectRun(response.workflow_runs, revision);
	if (!run) return null;
	const result = await api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
	if (result.total_count !== result.jobs.length) throw new Error('Incomplete validation evidence.');
	requireValidationJobs(result.jobs);
	return { run: run.id, attempt: run.run_attempt, url: run.html_url };
}

async function saveState(state) {
	await writeFile(`${stateFile}.new`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
	await rename(`${stateFile}.new`, stateFile);
}

async function activeRevision() {
	const manifest = JSON.parse(await readFile('/srv/kaordo/releases/current/manifest.json', 'utf8'));
	if (!revisionPattern.test(manifest.sourceCommit) || manifest.workingTreeDirty !== false)
		throw new Error('Active production must have a clean recorded revision.');
	return manifest.sourceCommit;
}

async function poll() {
	const state = JSON.parse(await readFile(stateFile, 'utf8'));
	if (!revisionPattern.test(state.baselineCommit) || !revisionPattern.test(state.activeCommit))
		throw new Error('CD must be bootstrapped from a recorded main and active production revision.');
	if (state.phase === 'activating') {
		const active = await command('systemctl', ['is-active', 'kaordo-cd-activate.service'], {
			capture: true,
			quiet: true
		}).catch(() => 'inactive');
		if (['active', 'activating'].includes(active)) return;
		if ((await activeRevision()) === state.candidate.sourceCommit) {
			await command(process.execPath, [
				'/etc/nixos/deploy/nixos/verify-release.mjs',
				'live',
				'/srv/kaordo/releases/current',
				state.candidate.id,
				'https://kaordo.link',
				'kaordo'
			]);
			await saveState({
				baselineCommit: state.baselineCommit,
				activeCommit: state.candidate.sourceCommit,
				phase: 'idle',
				proof: state.proof
			});
			return;
		}
		await saveState({
			...state,
			phase: 'failed',
			failedAttempt: state.attempt,
			error: 'Activation was interrupted; verify the host before retrying.'
		});
		throw new Error('Activation was interrupted; verify the host before retrying.');
	}
	const active = await activeRevision();
	if (state.activeCommit !== active) {
		state.activeCommit = active;
		await saveState(state);
	}
	const revision = await mainRevision();
	if (revision === state.baselineCommit || revision === state.activeCommit) return;
	const failedRevision = state.failedAttempt?.startsWith(`${revision}:`);
	const evidenceInterval = failedRevision ? 600_000 : 120_000;
	if (
		(state.waitingCommit === revision || failedRevision) &&
		Date.now() - (state.lastEvidenceAt || 0) < evidenceInterval
	)
		return;
	const proof = await evidence(revision);
	if (!proof) {
		if (state.waitingCommit !== revision) {
			console.log(`Waiting for complete main checks: ${revision}.`);
		}
		await saveState({ ...state, waitingCommit: revision, lastEvidenceAt: Date.now() });
		return;
	}
	const attempt = `${revision}:${proof.run}:${proof.attempt}`;
	if (state.failedAttempt === attempt) {
		await saveState({ ...state, lastEvidenceAt: Date.now() });
		return;
	}
	try {
		console.log(`Building checked main revision ${revision}; CI ${proof.url}.`);
		await command('systemctl', [
			'start',
			`kaordo-cd-build@${revision}-${state.activeCommit}.service`
		]);
		if ((await mainRevision()) !== revision || !(await evidence(revision))) {
			console.log('Main or its checks changed during preparation; candidate deferred.');
			return;
		}
		const candidate = JSON.parse(await readFile(join(buildRoot, 'candidate/release.json'), 'utf8'));
		const archive = await readFile(join(buildRoot, 'candidate/release.tar.gz'));
		if (createHash('sha256').update(archive).digest('hex') !== candidate.hash)
			throw new Error('Candidate archive checksum changed.');
		await mkdir(join(stateRoot, 'activation'), { recursive: true, mode: 0o700 });
		await writeFile(join(stateRoot, 'activation/release.tar.gz'), archive, { mode: 0o600 });
		const manifest = JSON.parse(
			await command(
				'tar',
				['-xOzf', join(stateRoot, 'activation/release.tar.gz'), 'manifest.json'],
				{ capture: true }
			)
		);
		validateCandidate(candidate, manifest, revision);
		for (const file of ['cd.mjs', 'checkpoint.mjs', 'deploy-release.sh'])
			await copyFile(join(import.meta.dirname, file), join(stateRoot, 'activation', file));
		await saveState({
			...state,
			phase: 'activating',
			candidate,
			proof,
			attempt,
			waitingCommit: null
		});
		// A transient unit survives a newer push, poller changes and NixOS activation
		await command('systemd-run', [
			'--unit=kaordo-cd-activate',
			'--collect',
			`--setenv=PATH=${process.env.PATH}`,
			'--property=Type=exec',
			'--property=UMask=0077',
			'--property=RuntimeMaxSec=45min',
			'--property=TimeoutStopSec=10min',
			process.execPath,
			join(stateRoot, 'activation/cd.mjs'),
			'activate'
		]);
	} catch (error) {
		await saveState({
			...state,
			phase: 'failed',
			failedAttempt: attempt,
			lastEvidenceAt: Date.now(),
			error: error.message
		});
		throw error;
	}
}

async function activate() {
	const state = JSON.parse(await readFile(stateFile, 'utf8'));
	const { candidate } = state;
	let archive;
	let locked = false;
	let interrupted = false;
	const interruptedHandler = () => {
		interrupted = true;
	};
	process.on('SIGTERM', interruptedHandler);
	process.on('SIGINT', interruptedHandler);
	const lock = '/srv/kaordo/tmp/production-deploy.lock';
	try {
		if (
			state.phase !== 'activating' ||
			(await mainRevision()) !== candidate.sourceCommit ||
			!(await evidence(candidate.sourceCommit))
		) {
			await saveState({ ...state, phase: 'idle' });
			return;
		}
		try {
			await mkdir(lock, { mode: 0o700 });
			locked = true;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			await saveState({ ...state, phase: 'idle' });
			console.log('Another host deployment owns the lock; deferring this candidate.');
			return;
		}
		if ((await activeRevision()) !== state.activeCommit)
			throw new Error('Active production changed during preparation.');
		await checkpoint(candidate.sourceCommit);
		// Check again after the checkpoint; a stale release never starts activation
		if (interrupted) throw new Error('Activation interrupted before changing the applications.');
		if (
			(await mainRevision()) !== candidate.sourceCommit ||
			!(await evidence(candidate.sourceCommit))
		) {
			await saveState({ ...state, phase: 'idle' });
			return;
		}
		archive = `/tmp/kaordo-${candidate.id}-full.tar.gz`;
		await copyFile(
			join(stateRoot, 'activation/release.tar.gz'),
			`${archive}.new`,
			constants.COPYFILE_EXCL
		);
		await rename(`${archive}.new`, archive);
		await command(
			'bash',
			[
				join(stateRoot, 'activation/deploy-release.sh'),
				candidate.id,
				candidate.hash,
				'kaordo.link',
				'kaordo',
				archive,
				candidate.sourceCommit
			],
			{ env: { ...process.env, KAORDO_DEPLOY_LOCK_HELD: candidate.id } }
		);
		const active = JSON.parse(await readFile('/srv/kaordo/releases/current/manifest.json', 'utf8'));
		validateCandidate(candidate, active, candidate.sourceCommit);
		await saveState({
			baselineCommit: state.baselineCommit,
			activeCommit: candidate.sourceCommit,
			phase: 'idle',
			deployedAt: new Date().toISOString(),
			proof: state.proof
		});
		console.log(`Production verified at ${candidate.sourceCommit}.`);
	} catch (error) {
		await saveState({
			...state,
			phase: 'failed',
			failedAttempt: state.attempt,
			lastEvidenceAt: Date.now(),
			error: error.message
		});
		throw error;
	} finally {
		if (archive) await rm(archive, { force: true });
		await rm(join(stateRoot, 'activation'), { recursive: true, force: true });
		if (locked) await rmdir(lock);
		process.off('SIGTERM', interruptedHandler);
		process.off('SIGINT', interruptedHandler);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		if (process.argv[2] === 'poll') await poll();
		else if (process.argv[2] === 'activate') await activate();
		else throw new Error('Specify poll or activate.');
	} catch (error) {
		console.error(`Automatic deployment failed: ${error.message}`);
		process.exitCode = 1;
	}
}
