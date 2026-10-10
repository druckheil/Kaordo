// Owns private deployment checkpoints, isolated restore verification and host process cleanup

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export async function command(
	program,
	args,
	{ capture = false, quiet = false, env = process.env } = {}
) {
	return new Promise((accept, reject) => {
		const child = spawn(program, args, {
			env,
			stdio: [
				'ignore',
				capture ? 'pipe' : quiet ? 'ignore' : 'inherit',
				quiet ? 'ignore' : 'inherit'
			]
		});
		let output = '';
		if (capture)
			child.stdout.setEncoding('utf8').on('data', (chunk) => {
				output += chunk;
			});
		child.on('error', () => reject(new Error(`${program} could not start.`)));
		child.on('close', (code) =>
			code === 0 ? accept(output.trim()) : reject(new Error(`${program} failed with code ${code}.`))
		);
	});
}

async function waitForIdentity() {
	for (let attempt = 0; attempt < 120; attempt++) {
		try {
			const response = await fetch('http://127.0.0.1:8080/realms/master', {
				signal: AbortSignal.timeout(3_000)
			});
			if (response.ok) return;
		} catch {
			/* Keycloak is still starting */
		}
		await new Promise((accept) => setTimeout(accept, 1_000));
	}
	throw new Error('Identity service did not recover after checkpoint creation.');
}

export async function checkpoint(
	revision,
	{
		dataRoot = '/srv/kaordo',
		stateRoot = '/var/lib/kaordo-cd',
		execute = command,
		waitIdentity = waitForIdentity,
		restore = restoreDump
	} = {}
) {
	if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid checkpoint revision.');
	const repository = join(dataRoot, 'deployment-backups');
	const password = join(dataRoot, 'secrets/deployment-backup-password');
	await mkdir(repository, { recursive: true, mode: 0o700 });
	try {
		await writeFile(password, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
	}
	const permissions = await stat(password);
	if (!permissions.isFile() || permissions.mode & 0o077 || permissions.uid !== process.getuid())
		throw new Error('Deployment backup password must remain private to its owner.');
	const env = {
		...process.env,
		RESTIC_REPOSITORY: repository,
		RESTIC_PASSWORD_FILE: password,
		RESTIC_CACHE_DIR: join(stateRoot, 'restic-cache')
	};
	const restic = (args, capture = false) => execute('restic', args, { quiet: true, capture, env });
	try {
		await stat(join(repository, 'config'));
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		await restic(['init', '--quiet']);
	}
	await restic(['check', '--quiet']);
	const id = `cd-${revision.slice(0, 12)}-${Date.now()}`;
	const staging = join(stateRoot, id);
	const restored = join(stateRoot, `${id}-restore`);
	const databases = ['kaordo', 'keycloak'];
	const temporaryDatabases = [];
	let mediaSnapshot = false;
	let servicesStopped = false;
	let failure;
	let snapshot;
	const failures = [];
	const postgres = (program, args, capture = false) =>
		execute('runuser', ['-u', 'postgres', '--', program, ...args], { quiet: true, capture });
	await mkdir(staging, { mode: 0o700 });
	try {
		// Drain content/media writes and freeze account changes before capturing their matching data
		servicesStopped = true;
		await execute('systemctl', ['stop', 'kerno', 'nodo', 'keycloak'], { quiet: true });
		try {
			for (const database of databases) {
				// PostgreSQL writes the dump as its own user, then root moves it into private staging
				const dump = join(dataRoot, 'postgresql', `${id}-${database}.dump`);
				try {
					await postgres('pg_dump', ['-Fc', '--file', dump, database]);
					await execute('mv', [dump, join(staging, `${database}.dump`)], { quiet: true });
				} finally {
					await rm(dump, { force: true });
				}
			}
			await execute(
				'btrfs',
				['subvolume', 'snapshot', '-r', join(dataRoot, 'media'), join(staging, 'media')],
				{ quiet: true }
			);
			mediaSnapshot = true;
		} finally {
			await execute('systemctl', ['start', 'keycloak'], { quiet: true });
			await waitIdentity();
			await execute('systemctl', ['start', 'nodo', 'kerno'], { quiet: true });
			servicesStopped = false;
		}
		await restic([
			'backup',
			'--quiet',
			'--tag',
			'kaordo-cd',
			'--tag',
			`revision:${revision}`,
			'--tag',
			id,
			staging,
			join(dataRoot, 'secrets'),
			'/etc/nixos'
		]);
		await restic(['check', '--quiet']);
		const snapshots = JSON.parse(await restic(['snapshots', '--json', '--tag', id], true));
		if (snapshots.length !== 1)
			throw new Error('Checkpoint must contain exactly one complete snapshot.');
		await mkdir(restored, { mode: 0o700 });
		// Read back the encrypted dumps and restore into disposable databases, never the live ones
		await restic([
			'restore',
			snapshots[0].id,
			'--target',
			restored,
			'--include',
			`${staging}/*.dump`,
			'--verify',
			'--quiet'
		]);
		for (const database of databases) {
			const name = `kaordo_cd_verify_${database}_${revision.slice(0, 12)}`;
			await postgres('createdb', ['--template=template0', name]);
			temporaryDatabases.push(name);
			// The private staging directory cannot be read by postgres; stream through root instead
			await restore(join(restored, staging.slice(1), `${database}.dump`), name);
			const table = database === 'kaordo' ? 'users' : 'realm';
			await postgres('psql', [
				'-X',
				'--set=ON_ERROR_STOP=1',
				'--tuples-only',
				'--no-align',
				name,
				'-c',
				`SELECT 1 FROM ${table} LIMIT 1`
			]);
		}
		await restic([
			'forget',
			'--quiet',
			'--tag',
			'kaordo-cd',
			'--group-by',
			'host',
			'--keep-last',
			'5',
			'--prune'
		]);
		await writeFile(
			join(stateRoot, 'checkpoint.json'),
			JSON.stringify({
				revision,
				snapshot: snapshots[0].id,
				verifiedAt: new Date().toISOString(),
				repository,
				independent: false
			}) + '\n',
			{ mode: 0o600 }
		);
		console.log('Encrypted deployment checkpoint and both disposable database restores verified.');
		snapshot = snapshots[0].id;
	} catch (error) {
		failure = error;
	} finally {
		const cleanup = async (operation) => {
			try {
				await operation();
			} catch {
				failures.push(true);
			}
		};
		if (servicesStopped) {
			await cleanup(() => execute('systemctl', ['start', 'keycloak'], { quiet: true }));
			await cleanup(waitIdentity);
			await cleanup(() => execute('systemctl', ['start', 'nodo', 'kerno'], { quiet: true }));
		}
		for (const database of temporaryDatabases)
			await cleanup(() => postgres('dropdb', ['--if-exists', database]));
		if (mediaSnapshot)
			await cleanup(() =>
				execute('btrfs', ['subvolume', 'delete', join(staging, 'media')], { quiet: true })
			);
		await cleanup(() => rm(staging, { recursive: true, force: true }));
		await cleanup(() => rm(restored, { recursive: true, force: true }));
	}
	if (failures.length)
		throw new Error('Checkpoint cleanup or service recovery needs operator attention.', {
			cause: failure
		});
	if (failure) throw failure;
	return snapshot;
}

async function restoreDump(path, database) {
	const child = spawn(
		'runuser',
		[
			'-u',
			'postgres',
			'--',
			'pg_restore',
			'--no-owner',
			'--no-acl',
			'--exit-on-error',
			'--dbname',
			database
		],
		{ stdio: ['pipe', 'ignore', 'ignore'] }
	);
	const completion = new Promise((accept, reject) => {
		child.once('error', () => reject(new Error('Disposable restore could not start.')));
		child.once('close', (code) =>
			code === 0 ? accept() : reject(new Error('Disposable checkpoint restore failed.'))
		);
	});
	try {
		await Promise.all([pipeline(createReadStream(path), child.stdin), completion]);
	} catch {
		child.kill('SIGTERM');
		await completion.catch(() => {});
		throw new Error('Disposable checkpoint restore failed.');
	}
}
