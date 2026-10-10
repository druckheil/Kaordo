// Installs the release a GitHub Actions run built, once that run's revision is still the branch head

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const artifactName = 'production-release';
const releasePattern = /^v\d+\.\d+\.\d+-[a-f0-9]{12}-\d{8}T\d{6}Z$/;
const keptRecords = 50;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const short = (revision) => revision.slice(0, 7);

/** Reads GitHub's workflow_ref: owner/repository/.github/workflows/file.yml@refs/heads/branch. */
export function parseWorkflow(value) {
	const match = /^([\w.-]+\/[\w.-]+)\/(\.github\/workflows\/[\w.-]+)@refs\/heads\/(.+)$/.exec(
		value ?? ''
	);
	if (!match) throw new Error('KAORDO_DEPLOY_WORKFLOW must be a workflow_ref on a branch.');
	return { repository: match[1], path: match[2], branch: match[3] };
}

export function githubClient(repository, token, request = fetch) {
	return async (path, { binary = false } = {}) => {
		// Downloads redirect to storage on another origin; fetch does not forward the token there
		const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
			headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(120_000)
		});
		if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}.`);
		return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
	};
}

/**
 * Decides whether run may replace production and installs its release. Only the branch head that
 * passed the run's checks deploys, and only on top of the history production already runs.
 */
export async function deploy(run, { workflow, github, production, unpack, install, report }) {
	const details = await github(`actions/runs/${run}`);
	const revision = details.head_sha;
	await report({ state: 'deploying', revision });
	const failed = (message, extra = {}) => ({ state: 'failed', revision, message, ...extra });
	if (
		details.event !== 'push' ||
		details.head_branch !== workflow.branch ||
		details.path !== workflow.path
	)
		return failed(`Run ${run} is not a push to ${workflow.branch} checked by ${workflow.path}.`);
	const { jobs } = await github(`actions/runs/${run}/jobs?filter=all&per_page=100`);
	if (!jobs.some((job) => job.name === 'checks' && job.conclusion === 'success'))
		return failed(`Run ${run} has not passed its checks.`);
	const head = (await github(`branches/${encodeURIComponent(workflow.branch)}`)).commit.sha;
	if (head !== revision)
		return {
			state: 'superseded',
			revision,
			message: `${workflow.branch} moved on to ${short(head)}.`
		};

	const active = await production();
	if (active.sourceCommit === revision)
		return { state: 'succeeded', revision, message: 'Production already runs this revision.' };
	const { status } = await github(`compare/${active.sourceCommit}...${revision}`);
	if (status !== 'ahead')
		return failed(
			`Production runs ${short(active.sourceCommit)}, which ${short(revision)} does not contain.`
		);

	const { artifacts } = await github(`actions/runs/${run}/artifacts?name=${artifactName}`);
	const artifact = artifacts.find(({ name, expired }) => name === artifactName && !expired);
	if (!artifact) return failed(`Run ${run} kept no ${artifactName} artifact.`);
	const zip = await github(`actions/artifacts/${artifact.id}/zip`, { binary: true });
	if (`sha256:${sha256(zip)}` !== artifact.digest)
		return failed('The downloaded release does not match the digest GitHub recorded.');
	const { release, archive } = await unpack(zip);
	if (
		!releasePattern.test(release.id) ||
		release.sourceCommit !== revision ||
		sha256(await readFile(archive)) !== release.hash
	)
		return failed(`The release is not the one run ${run} built from ${short(revision)}.`);

	// deploy-release.sh exits with 70 only when its rollback failed too
	const code = await install(release, archive, active);
	if (code === 0)
		return { state: 'succeeded', revision, message: `Production runs ${release.id}.` };
	if (code === 70)
		return failed('The release failed and its rollback needs operator attention.', {
			rollbackFailed: true
		});
	return failed('The release failed its checks; production keeps the previous release.');
}

export async function unpackRelease(zip) {
	const directory = await mkdtemp(join(tmpdir(), 'kaordo-deploy-'));
	try {
		await writeFile(join(directory, 'release.zip'), zip);
		if ((await execute('unzip', ['-q', join(directory, 'release.zip'), '-d', directory])) !== 0)
			throw new Error('The release artifact is not a readable archive.');
		const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
		if (!releasePattern.test(release.id)) throw new Error('The release has an invalid ID.');
		// deploy-release.sh accepts the archive only at this path
		const archive = `/tmp/kaordo-${release.id}-full.tar.gz`;
		await rename(join(directory, 'release.tar.gz'), archive);
		return { release, archive };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function execute(program, args) {
	return new Promise((accept, reject) => {
		const child = spawn(program, args, { stdio: 'inherit' });
		child.once('error', reject);
		child.once('close', (code) => accept(code));
	});
}

async function record(directory, entry) {
	const path = join(directory, `${entry.run}.json`);
	await writeFile(`${path}.new`, JSON.stringify(entry) + '\n', { mode: 0o600 });
	await rename(`${path}.new`, path);
	const runs = (await readdir(directory))
		.map((name) => Number(/^(\d+)\.json$/.exec(name)?.[1]))
		.filter(Boolean)
		.sort((a, b) => b - a);
	for (const old of runs.slice(keptRecords))
		await rm(join(directory, `${old}.json`), { force: true });
}

async function main() {
	const run = Number(process.argv[2]);
	if (!Number.isSafeInteger(run) || run < 1) throw new Error('Specify a GitHub Actions run ID.');
	const workflow = parseWorkflow(process.env.KAORDO_DEPLOY_WORKFLOW);
	const token = (
		await readFile(join(process.env.CREDENTIALS_DIRECTORY, 'github-token'), 'utf8')
	).trim();
	let entry = { run, state: 'deploying' };
	const report = async (change) => {
		entry = { ...entry, ...change, updatedAt: new Date().toISOString() };
		await record(process.env.STATE_DIRECTORY, entry);
	};
	try {
		const result = await deploy(run, {
			workflow,
			github: githubClient(workflow.repository, token),
			production: async () =>
				JSON.parse(await readFile('/srv/kaordo/releases/current/manifest.json', 'utf8')),
			unpack: unpackRelease,
			install: (release, archive, active) =>
				execute('bash', [
					join(import.meta.dirname, 'deploy-release.sh'),
					release.id,
					release.hash,
					new URL(active.origin).hostname,
					active.realm,
					archive,
					release.sourceCommit
				]),
			report
		});
		await report(result);
		console.log(`${result.state}: ${result.message}`);
		if (result.state === 'failed') process.exitCode = 1;
	} catch (error) {
		await report({ state: 'failed', message: error.message });
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main().catch((error) => {
		console.error(`Deployment failed: ${error.message}`);
		process.exitCode = 1;
	});
}
