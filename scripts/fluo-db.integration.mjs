import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify, parseEnv } from 'node:util';
import { fluoMigrations } from './fluo-migrations.mjs';

const run = promisify(execFile);
const database = `fluo_test_${randomBytes(4).toString('hex')}`;
const container = 'local-app-db-1';

async function migrate(file) {
  const sql = await readFile(new URL(file, import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'kaordo', '-d', database], {
      stdio: ['pipe', 'ignore', 'pipe']
    });
    let errorText = '';
    child.stderr.on('data', (chunk) => { errorText += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Migration ${file} failed: ${errorText}`)));
    child.stdin.end(sql);
  });
}

const config = parseEnv(await readFile('deploy/local/.env', 'utf8'));
if (!config.KAORDO_DB_PASSWORD) throw new Error('Local database credentials are missing. Run pnpm dev first.');
await run('docker', ['exec', container, 'createdb', '-U', 'kaordo', database]);
try {
  await migrate('../deploy/postgres/001_users.sql');
  for (const migration of fluoMigrations) {
    await migrate(`../deploy/postgres/${migration}`);
  }
  const dsn = `postgres://kaordo:${encodeURIComponent(config.KAORDO_DB_PASSWORD)}@127.0.0.1:5432/${database}?sslmode=disable`;
  const { stdout } = await run('go', ['test', './services/kerno/internal/postgres', '-cover', '-run', 'TestFluo', '-count=1', '-v'], {
    env: { ...process.env, KAORDO_TEST_DATABASE_URL: dsn }
  });
  process.stdout.write(stdout);
} finally {
  await run('docker', ['exec', container, 'dropdb', '-U', 'kaordo', database]);
}
