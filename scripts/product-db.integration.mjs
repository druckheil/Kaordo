// Runs Kerno's PostgreSQL tests against a disposable database in local Compose or the CI service container

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify, parseEnv } from 'node:util';

const run = promisify(execFile);
const database = `kaordo_test_${randomBytes(4).toString('hex')}`;
const container = process.env.KAORDO_TEST_DB_CONTAINER || 'local-app-db-1';

const config = process.env.KAORDO_DB_PASSWORD
	? { KAORDO_DB_PASSWORD: process.env.KAORDO_DB_PASSWORD }
	: parseEnv(await readFile('deploy/local/.env', 'utf8'));
if (!config.KAORDO_DB_PASSWORD)
	throw new Error('Local database credentials are missing. Run pnpm dev first.');

await run('docker', ['exec', container, 'createdb', '-U', 'kaordo', database]);
try {
	const dsn = `postgres://kaordo:${encodeURIComponent(config.KAORDO_DB_PASSWORD)}@127.0.0.1:5432/${database}?sslmode=disable`;
	// The tests apply the embedded migrations once, then check generated Jet tables against the schema
	const { stdout } = await run(
		'go',
		['test', './internal/postgres', '-race', '-cover', '-count=1', '-v'],
		{ cwd: 'services/kerno', env: { ...process.env, KAORDO_TEST_DATABASE_URL: dsn } }
	);
	process.stdout.write(stdout);
} finally {
	await run('docker', ['exec', container, 'dropdb', '-U', 'kaordo', database]);
}
