// Downloads, verifies and installs a trusted Actions release with durable progress and diagnostics

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createDeploymentReport } from './deployment-report.mjs';
import { verifyLiveRelease } from './verify-release.mjs';

const artifactName = 'production-release';
const releasePattern = /^v\d+\.\d+\.\d+-[a-f0-9]{12}-\d{8}T\d{6}Z$/;
const keptRecords = 50;
const short = (revision) => revision.slice(0, 7);

export function parseWorkflow(value) {
	const match = /^([\w.-]+\/[\w.-]+)\/(\.github\/workflows\/[\w.-]+)@refs\/heads\/(.+)$/.exec(
		value ?? ''
	);
	if (!match) throw new Error('KAORDO_DEPLOY_WORKFLOW must be a workflow_ref on a branch.');
	return { repository: match[1], path: match[2], branch: match[3] };
}

export function githubClient(repository, token, request = fetch) {
	return async (path, { raw = false, signal = AbortSignal.timeout(30_000) } = {}) => {
		try {
			// Fetch strips Authorization when GitHub redirects to artifact storage
			const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
				headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
				signal
			});
			if (!response.ok) {
				const error = new Error(`GitHub answered HTTP ${response.status} for ${path}.`);
				error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
				throw error;
			}
			return raw ? response : await response.json();
		} catch (error) {
			if (error.retryable !== undefined) throw error;
			throw new Error(
				`GitHub request ${path} ${signal.aborted ? 'timed out' : 'could not complete'}.`,
				{ cause: error }
			);
		}
	};
}

/** Streams to disk; slow transfers may continue, but a silent or oversized transfer cannot. */
export async function downloadArtifact(
	github,
	artifact,
	path,
	progress,
	{ signal, idleMs = 60_000, deadlineMs = 15 * 60_000 } = {}
) {
	if (
		!/^sha256:[a-f0-9]{64}$/.test(artifact.digest) ||
		!Number.isSafeInteger(artifact.size_in_bytes) ||
		artifact.size_in_bytes < 1 ||
		artifact.size_in_bytes > 256 * 1024 * 1024
	)
		throw new Error('GitHub recorded an invalid release artifact size or digest.');
	const controller = new AbortController();
	const abort = () => controller.abort(signal.reason);
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	const deadline = setTimeout(
		() => controller.abort(new Error('The artifact download exceeded its 15-minute deadline.')),
		deadlineMs
	);
	let idle;
	const resetIdle = () => {
		clearTimeout(idle);
		idle = setTimeout(
			() => controller.abort(new Error('The artifact download stopped receiving bytes.')),
			idleMs
		);
	};
	let file;
	let reader;
	const cancelReader = () => {
		void reader?.cancel().catch(() => {});
	};
	controller.signal.addEventListener('abort', cancelReader, { once: true });
	let received = 0;
	try {
		resetIdle();
		const response = await github(`actions/artifacts/${artifact.id}/zip`, {
			raw: true,
			signal: controller.signal
		});
		if (!response.body) throw new Error('GitHub returned an empty release artifact.');
		file = await open(path, 'w', 0o600);
		reader = response.body.getReader();
		if (controller.signal.aborted) throw controller.signal.reason;
		const digest = createHash('sha256');
		let lastReport = 0;
		await progress({ receivedBytes: 0, totalBytes: artifact.size_in_bytes });
		while (true) {
			const { value, done } = await reader.read();
			if (controller.signal.aborted) throw controller.signal.reason;
			if (done) break;
			resetIdle();
			received += value.byteLength;
			if (received > artifact.size_in_bytes)
				throw new Error('The artifact exceeds the size GitHub recorded.');
			digest.update(value);
			await file.writeFile(value);
			if (Date.now() - lastReport >= 5000) {
				await progress({ receivedBytes: received, totalBytes: artifact.size_in_bytes });
				lastReport = Date.now();
			}
		}
		if (received !== artifact.size_in_bytes || `sha256:${digest.digest('hex')}` !== artifact.digest)
			throw new Error('The downloaded release does not match the size and digest GitHub recorded.');
		await progress({ receivedBytes: received, totalBytes: artifact.size_in_bytes });
	} catch (error) {
		await rm(path, { force: true });
		const cause = controller.signal.aborted ? controller.signal.reason : error;
		const failure = new Error(
			`Artifact download failed after ${received} of ${artifact.size_in_bytes} bytes: ${cause.message}`,
			{ cause }
		);
		failure.retryable =
			!signal?.aborted &&
			(controller.signal.aborted ||
				error.retryable === true ||
				error instanceof TypeError ||
				error.cause instanceof TypeError);
		throw failure;
	} finally {
		clearTimeout(deadline);
		clearTimeout(idle);
		signal?.removeEventListener('abort', abort);
		controller.signal.removeEventListener('abort', cancelReader);
		await reader?.cancel().catch(() => {});
		await file?.close();
	}
}

export async function deploy(
	run,
	{
		attempt = 1,
		revision: requestedRevision,
		workflow,
		github,
		production,
		download,
		unpack,
		install,
		verify,
		report
	}
) {
	await report.phase('authorization', `Checking workflow run ${run}, attempt ${attempt}.`);
	const details = await github(`actions/runs/${run}`);
	const revision = details.head_sha;
	await report.report({ revision });
	const failed = (message, extra = {}) => ({ state: 'failed', revision, message, ...extra });
	if (
		details.event !== 'push' ||
		details.head_branch !== workflow.branch ||
		details.path !== workflow.path ||
		details.run_attempt !== attempt ||
		(requestedRevision && revision !== requestedRevision)
	)
		return failed(
			`Run ${run}, attempt ${attempt} is not the requested trusted push to ${workflow.branch}.`
		);
	let { jobs } = await github(`actions/runs/${run}/jobs?filter=latest&per_page=100`);
	// Re-running only deployment can reuse an unchanged run's latest checks; an older success
	// must never hide a more recent failed gate
	if (!jobs.some((job) => job.name === 'checks')) {
		const all = await github(`actions/runs/${run}/jobs?filter=all&per_page=100`);
		jobs = all.jobs;
		for (let page = 2; jobs.length < all.total_count; page++) {
			const next = await github(`actions/runs/${run}/jobs?filter=all&per_page=100&page=${page}`);
			if (!next.jobs.length) return failed('GitHub did not return the complete checks history.');
			jobs.push(...next.jobs);
		}
	}
	const checks = jobs.filter((job) => job.name === 'checks').sort((a, b) => b.id - a.id)[0];
	if (checks?.conclusion !== 'success' || checks.head_sha !== revision)
		return failed(`Run ${run}, attempt ${attempt} has not passed its checks.`);
	const head = async () =>
		(await github(`branches/${encodeURIComponent(workflow.branch)}`)).commit.sha;
	const superseded = (head) => ({
		state: 'superseded',
		revision,
		message: `${workflow.branch} moved on to ${short(head)}.`
	});
	const branchHead = await head();
	if (branchHead !== revision) return superseded(branchHead);
	const active = await production();
	await report.report({ previousRelease: active.release });
	if (active.sourceCommit === revision) {
		await report.phase(
			'live_verification',
			'Checking the revision already installed on production.'
		);
		await verify(active);
		return {
			state: 'succeeded',
			revision,
			release: active.release,
			message: 'Production already runs this revision and passed live verification.'
		};
	}
	const { status } = await github(`compare/${active.sourceCommit}...${revision}`);
	if (status !== 'ahead')
		return failed(
			`Production runs ${short(active.sourceCommit)}, which ${short(revision)} does not contain.`
		);
	const { artifacts } = await github(`actions/runs/${run}/artifacts?name=${artifactName}`);
	const artifact = artifacts.find(({ name, expired }) => name === artifactName && !expired);
	if (!artifact) return failed(`Run ${run} kept no ${artifactName} artifact.`);
	await report.phase(
		'download',
		`Downloading the verified release artifact (${artifact.size_in_bytes} bytes).`
	);
	const zip = await download(artifact);
	await report.phase(
		'verification',
		'Checking the artifact, source revision and release checksum.'
	);
	const { release, archive } = await unpack(zip);
	if (
		!releasePattern.test(release.id) ||
		release.sourceCommit !== revision ||
		createHash('sha256')
			.update(await readFile(archive))
			.digest('hex') !== release.hash
	)
		return failed(`The release is not the one run ${run} built from ${short(revision)}.`);
	await report.report({ release: release.id });
	// A newer main revision may have arrived while a slow transfer was in progress
	const finalHead = await head();
	if (finalHead !== revision) return superseded(finalHead);
	await report.phase('preflight', 'Starting the verified installer.');
	// Persist possible host changes before the child can mutate anything; output may lag a crash
	await report.report({ hostChanged: true });
	const code = await install(release, archive, active);
	if (code === 0)
		return {
			state: 'succeeded',
			revision,
			release: release.id,
			message: `Production runs ${release.id} and passed live verification.`
		};
	const problem = report.entry.error?.message ?? `The installer exited with status ${code}.`;
	if (code === 70 || (report.entry.hostChanged && report.entry.rollback !== 'succeeded'))
		return failed(
			`${problem} Restoring the previous release failed; operator attention is required.`,
			{ rollbackFailed: true }
		);
	return failed(
		`${problem} ${report.entry.rollback === 'succeeded' ? 'The previous release was restored.' : 'The failure occurred before activation.'}`
	);
}

export async function unpackRelease(zip, directory) {
	if ((await execute('unzip', ['-q', zip, '-d', directory])) !== 0)
		throw new Error('The release artifact is not a readable archive.');
	const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
	if (!releasePattern.test(release.id)) throw new Error('The release has an invalid ID.');
	const archive = `/tmp/kaordo-${release.id}-full.tar.gz`;
	await rename(join(directory, 'release.tar.gz'), archive);
	return { release, archive };
}

export function execute(program, args, report, signal) {
	return new Promise((accept, reject) => {
		const child = spawn(program, args, { stdio: report ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
		const cancel = () => child.kill('SIGTERM');
		signal?.addEventListener('abort', cancel, { once: true });
		if (signal?.aborted) cancel();
		let output = Promise.resolve();
		const readers = [];
		if (report)
			for (const [stream, level] of [
				[child.stdout, 'info'],
				[child.stderr, 'warning']
			]) {
				const reader = createInterface({ input: stream, crlfDelay: Infinity });
				readers.push(reader);
				reader.on('line', (line) => {
					if (!line.trim()) return;
					console.log(line);
					output = output.then(() => report.output(line, level));
					// Losing the durable journal must stop the installer, not leave an unobservable release
					output.catch(cancel);
				});
			}
		child.once('error', reject);
		child.once('close', async (code, exitSignal) => {
			signal?.removeEventListener('abort', cancel);
			for (const reader of readers) reader.close();
			try {
				await output;
				if (exitSignal) throw new Error(`${program} was interrupted by ${exitSignal}.`);
				accept(code);
			} catch (error) {
				reject(error);
			}
		});
	});
}

async function main() {
	const match = /^(\d+)-(\d+)$/.exec(process.argv[2] ?? '');
	if (
		!match ||
		!match.slice(1).every((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0)
	)
		throw new Error('Specify a GitHub Actions run-attempt instance.');
	const [run, attempt] = match.slice(1).map(Number);
	const directory = process.env.STATE_DIRECTORY;
	// Start() persists the queued request before systemd begins executing it
	const request = JSON.parse(await readFile(join(directory, `${run}.json`), 'utf8'));
	if (request.attempt !== attempt)
		throw new Error('The queued attempt no longer matches this unit.');
	const token = (
		await readFile(join(process.env.CREDENTIALS_DIRECTORY, 'github-token'), 'utf8')
	).trim();
	const report = await createDeploymentReport(directory, request, [token]);
	const abort = new AbortController();
	const stop = () => abort.abort(new Error('The deployment was interrupted.'));
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
	const heartbeat = setInterval(() => {
		report.report().catch(stop);
	}, 5000);
	let scratch;
	let archive;
	try {
		const workflow = parseWorkflow(process.env.KAORDO_DEPLOY_WORKFLOW);
		const github = githubClient(workflow.repository, token);
		scratch = await mkdtemp(join(tmpdir(), 'kaordo-deploy-'));
		const result = await deploy(run, {
			attempt,
			revision: request.revision,
			workflow,
			github,
			production: async () =>
				JSON.parse(await readFile('/srv/kaordo/releases/current/manifest.json', 'utf8')),
			download: async (artifact) => {
				const zip = join(scratch, 'release.zip');
				for (let transfer = 1; ; transfer++) {
					await report.report(
						{ message: `Downloading the release (transfer ${transfer}/3).` },
						{ message: `Artifact transfer ${transfer} started.` }
					);
					try {
						await downloadArtifact(
							github,
							artifact,
							zip,
							(progress) => report.report({ progress }),
							{ signal: abort.signal }
						);
						return zip;
					} catch (error) {
						if (!error.retryable || transfer >= 3) throw error;
						await report.report(
							{ message: `Download attempt ${transfer} failed; reconnecting.` },
							{ level: 'warning', message: error.message }
						);
						await delay(5000, undefined, { signal: abort.signal });
					}
				}
			},
			unpack: async (zip) => {
				const result = await unpackRelease(zip, scratch);
				archive = result.archive;
				return result;
			},
			install: (release, path, active) =>
				execute(
					'bash',
					[
						join(import.meta.dirname, 'deploy-release.sh'),
						release.id,
						release.hash,
						new URL(active.origin).hostname,
						active.realm,
						path,
						release.sourceCommit,
						`${run}-${attempt}`
					],
					report,
					abort.signal
				),
			verify: (active) => verifyLiveRelease('/srv/kaordo/releases/current', active),
			report
		});
		if (result.state === 'failed' && !report.entry.error)
			result.error = { phase: report.entry.phase, message: result.message };
		await report.report(
			{ ...result, phase: result.state === 'succeeded' ? 'complete' : report.entry.phase },
			{ level: result.state === 'failed' ? 'error' : 'info', message: result.message }
		);
		if (result.state === 'failed') process.exitCode = 1;
	} catch (error) {
		const failure = report.entry.error ?? { phase: report.entry.phase, message: error.message };
		const rollbackFailed =
			report.entry.hostChanged === true && report.entry.rollback !== 'succeeded';
		await report.report(
			{
				state: 'failed',
				error: failure,
				rollbackFailed,
				message: `${failure.phase}: ${failure.message}${rollbackFailed ? ' Installation or rollback was interrupted; operator attention is required.' : ''}`
			},
			{ level: 'error', message: error.message }
		);
		process.exitCode = 1;
	} finally {
		clearInterval(heartbeat);
		process.off('SIGTERM', stop);
		process.off('SIGINT', stop);
		await report.report();
		if (archive) await rm(archive, { force: true });
		if (scratch) await rm(scratch, { recursive: true, force: true });
		const records = (await readdir(directory))
			.filter((name) => /^\d+\.json$/.test(name))
			.sort((a, b) => Number.parseInt(b) - Number.parseInt(a));
		for (const old of records.slice(keptRecords)) await rm(join(directory, old), { force: true });
		console.log(`${report.entry.state}: ${report.entry.message}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main().catch((error) => {
		console.error(`Deployment failed: ${error.message}`);
		process.exitCode = 1;
	});
}
