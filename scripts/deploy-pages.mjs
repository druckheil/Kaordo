// Builds, validates and atomically deploys the static production applications
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	assertSourceState,
	getSourceState,
	root,
	run,
	sshArguments,
	validateTarget
} from './deploy-support.mjs';

async function createRelease(source, origin) {
	const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
	const createdAt = new Date()
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z');
	const release = `v${packageJson.version}-${source.commit}-pages-${createdAt}${source.dirty ? '-dirty' : ''}`;
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kaordo-pages-release-'));
	const artifact = join(temporaryDirectory, `${release}.tar.gz`);
	const pages = join(root, 'dist/pages');
	const staging = join(temporaryDirectory, 'package');
	try {
		await mkdir(staging, { recursive: true });
		await cp(pages, join(staging, 'site'), { recursive: true });
		await writeFile(
			join(staging, 'RELEASE.txt'),
			[
				'Kaordo static frontend release',
				`Release: ${release}`,
				`Source commit: ${source.revision}`,
				`Working tree dirty: ${source.dirty}`,
				`Public origin: ${origin.origin}`,
				`Built at: ${new Date().toISOString()}`,
				'This release contains no backend binaries or database migrations.',
				''
			].join('\n')
		);
		await run('tar', ['--no-xattrs', '-czf', artifact, '-C', staging, 'site', 'RELEASE.txt'], {
			env: { ...process.env, COPYFILE_DISABLE: '1' }
		});
		const hash = createHash('sha256')
			.update(await readFile(artifact))
			.digest('hex');
		return { release, temporaryDirectory, artifact, hash };
	} catch (error) {
		await rm(temporaryDirectory, { recursive: true, force: true });
		throw error;
	}
}

export async function deployPages({ allowDirty = false } = {}) {
	const { host, origin, realm } = validateTarget();
	const source = await getSourceState(allowDirty);
	const ssh = await sshArguments();
	await run('ssh', [...ssh, host, 'sudo -n true']);
	await run('pnpm', ['test:pages:production']);

	const release = await createRelease(source, origin);
	await assertSourceState(source);
	const remoteArchive = `/tmp/kaordo-${release.release}.tar.gz`;
	try {
		await run('scp', [...ssh, release.artifact, `${host}:${remoteArchive}`]);
		const remoteScript = await readFile(join(root, 'deploy/nixos/deploy-static.sh'), 'utf8');
		const remoteCommand = `sudo -n bash -s -- ${release.release} ${release.hash} ${origin.hostname} ${realm} ${remoteArchive} ${source.revision}`;
		await run('ssh', [...ssh, host, remoteCommand], { input: remoteScript });
		process.stdout.write(`Deployed ${release.release} to ${host}\n`);
	} finally {
		await rm(release.temporaryDirectory, { recursive: true, force: true });
	}
}

async function main() {
	const args = process.argv.slice(2);
	const unsupported = args.filter((argument) => argument !== '--allow-dirty');
	if (unsupported.length) throw new Error(`unsupported argument: ${unsupported[0]}`);
	await deployPages({ allowDirty: args.includes('--allow-dirty') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		await main();
	} catch (error) {
		process.stderr.write(`Static deployment failed: ${error.message}\n`);
		process.exitCode = 1;
	}
}
