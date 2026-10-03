import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('encrypted local backup restores both databases into disposable copies', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaordo-backup-test-'));
  const passwordFile = join(directory, 'password');
  const environment = {
    ...process.env,
    RESTIC_REPOSITORY: join(directory, 'repository'),
    RESTIC_PASSWORD_FILE: passwordFile
  };
  try {
    await writeFile(passwordFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    await run('restic', ['init'], { env: environment, timeout: 30_000 });
    await run(process.execPath, ['scripts/local-backup.mjs', 'backup'], { env: environment, timeout: 120_000 });
    await run(process.execPath, ['scripts/local-backup.mjs', 'verify'], { env: environment, timeout: 120_000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
