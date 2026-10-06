// Migrates and exercises a disposable database against local Compose or a CI PostgreSQL service

import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify, parseEnv } from 'node:util';
import { productMigrations } from './product-migrations.mjs';

const run = promisify(execFile);
const database = `kaordo_test_${randomBytes(4).toString('hex')}`;
const container = process.env.KAORDO_TEST_DB_CONTAINER || 'local-app-db-1';

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

const config = process.env.KAORDO_DB_PASSWORD
  ? { KAORDO_DB_PASSWORD: process.env.KAORDO_DB_PASSWORD }
  : parseEnv(await readFile('deploy/local/.env', 'utf8'));
if (!config.KAORDO_DB_PASSWORD) throw new Error('Local database credentials are missing. Run pnpm dev first.');
await run('docker', ['exec', container, 'createdb', '-U', 'kaordo', database]);
try {
  await migrate('../deploy/postgres/001_users.sql');
  for (const migration of productMigrations) {
    await migrate(`../deploy/postgres/${migration}`);
  }
  const dsn = `postgres://kaordo:${encodeURIComponent(config.KAORDO_DB_PASSWORD)}@127.0.0.1:5432/${database}?sslmode=disable`;
  const { stdout } = await run('go', ['test', './services/kerno/internal/postgres', '-race', '-cover', '-run', 'Test(Fluo|Ligo|Rondo|Admin)', '-count=1', '-v'], {
    env: { ...process.env, KAORDO_TEST_DATABASE_URL: dsn }
  });
  process.stdout.write(stdout);
  await run('docker', ['exec', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'kaordo', '-d', database,
    '-c', `CREATE TABLE fluo_upload_claims (LIKE nodo_upload_claims INCLUDING ALL);
      INSERT INTO fluo_upload_claims SELECT * FROM nodo_upload_claims
      WHERE upload_id = '01999111-2222-7333-8444-555555555592'::uuid;
      DELETE FROM nodo_upload_claims
      WHERE upload_id = '01999111-2222-7333-8444-555555555592'::uuid;`]);
  for (const migration of productMigrations) {
    await migrate(`../deploy/postgres/${migration}`);
  }
  const claim = await run('docker', ['exec', container, 'psql', '-X', '-At', '-U', 'kaordo', '-d', database,
    '-c', "SELECT retired_at IS NULL FROM nodo_upload_claims WHERE upload_id = '01999111-2222-7333-8444-555555555592'::uuid"]);
  if (claim.stdout.trim() !== 't') throw new Error('Ligo file claim was retired by the second migration pass.');
  process.stdout.write('Migration replay preserved the legacy claim and Ligo file reference.\n');
} finally {
  await run('docker', ['exec', container, 'dropdb', '-U', 'kaordo', database]);
}
