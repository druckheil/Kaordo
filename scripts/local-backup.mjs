import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, '..');
const databases = [
  { name: 'app-db', container: 'local-app-db-1', role: 'kaordo', database: 'kaordo', table: 'users' },
  { name: 'identity-db', container: 'local-identity-db-1', role: 'keycloak', database: 'keycloak', table: 'realm' }
];
const media = { name: 'media', path: resolve(projectRoot, 'deploy/local/media') };
const components = [...databases.map((database) => database.name), media.name];

async function run(command, args) {
  try {
    const { stdout } = await exec(command, args, { maxBuffer: 32_000_000 });
    return stdout;
  } catch {
    throw new Error(`${command} ${args[0]} failed. Check that the local containers and encrypted backup repository are available.`);
  }
}

function configuration() {
  const repository = process.env.RESTIC_REPOSITORY;
  const passwordFile = process.env.RESTIC_PASSWORD_FILE;
  if (!repository || !passwordFile) {
    throw new Error('Set RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE before using the local backup commands.');
  }
  const insideProject = (path) => {
    const fromRoot = relative(projectRoot, resolve(path));
    return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
  };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(repository) && insideProject(repository)) {
    throw new Error('The backup repository must be outside the Kaordo source tree.');
  }
  if (insideProject(passwordFile)) {
    throw new Error('RESTIC_PASSWORD_FILE must be outside the Kaordo source tree.');
  }
  return { repository, passwordFile };
}

async function preflight() {
  configuration();
  const key = await stat(process.env.RESTIC_PASSWORD_FILE);
  if (!key.isFile() || (key.mode & 0o077) !== 0) {
    throw new Error('RESTIC_PASSWORD_FILE must be a private file (chmod 600).');
  }
  await run('restic', ['snapshots', '--json']);
}

async function snapshots() {
  const items = JSON.parse(await run('restic', ['snapshots', '--json']));
  return items.filter((snapshot) => snapshot.tags?.includes('kaordo-local'));
}

export function latestPair(items) {
  const runs = new Map();
  for (const snapshot of items) {
    const runTag = snapshot.tags.find((tag) => tag.startsWith('run:'));
    const name = components.find((component) => snapshot.tags.includes(component));
    if (!runTag || !name) continue;
    const pair = runs.get(runTag) || {};
    pair[name] = snapshot;
    runs.set(runTag, pair);
  }
  const complete = [...runs.entries()].filter(([, pair]) => components.every((component) => pair[component]));
  complete.sort(([a], [b]) => b.localeCompare(a));
  if (complete.length === 0) throw new Error('No complete local backup set exists in this repository.');
  return complete[0];
}

async function streamRestore(snapshot, database, temporaryName) {
  const source = spawn('restic', ['dump', snapshot.id, `/${database.name}.dump`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const target = spawn('docker', [
    'exec', '-i', database.container,
    'pg_restore', '--no-owner', '--no-acl', '--exit-on-error',
    '-U', database.role, '-d', temporaryName
  ], { stdio: ['pipe', 'ignore', 'ignore'] });
  source.stdout.pipe(target.stdin);
  target.stdin.on('error', () => {});
  const [sourceExit, targetExit] = await Promise.all([once(source, 'close'), once(target, 'close')]);
  if (sourceExit[0] !== 0 || targetExit[0] !== 0) {
    throw new Error(`Could not restore ${database.name} into a disposable database.`);
  }
}

export async function backupLocal() {
  await preflight();
  await mkdir(media.path, { recursive: true, mode: 0o700 });
  const runId = `${new Date().toISOString().replace(/\D/g, '')}-${randomBytes(3).toString('hex')}`;
  for (const database of databases) {
    await run('restic', [
      'backup', '--quiet', '--tag', 'kaordo-local', '--tag', `run:${runId}`, '--tag', database.name,
      '--stdin-filename', `${database.name}.dump`, '--stdin-from-command', '--',
      'docker', 'exec', database.container,
      'pg_dump', '-U', database.role, '-Fc', database.database
    ]);
  }
  await run('restic', [
    'backup', '--quiet', '--tag', 'kaordo-local', '--tag', `run:${runId}`, '--tag', media.name,
    media.path
  ]);
  const [completedRun] = latestPair(await snapshots());
  if (completedRun !== `run:${runId}`) throw new Error('The new backup pair is incomplete.');
  console.log(`Encrypted local backup complete: ${runId}`);
}

export async function verifyLocalBackup() {
  await preflight();
  const [runTag, pair] = latestPair(await snapshots());
  await run('restic', ['check', '--read-data', '--quiet']);
  const temporaryNames = new Map();
  const mediaRestore = await mkdtemp(join(tmpdir(), 'kaordo-media-restore-'));
  try {
    await run('restic', ['restore', pair[media.name].id, '--target', mediaRestore]);
    const restoredMedia = join(mediaRestore, relative('/', media.path));
    const mediaFiles = await readdir(restoredMedia);
    for (const file of mediaFiles.filter((name) => name.endsWith('.ready.json'))) {
      const id = file.slice(0, -'.ready.json'.length);
      await stat(join(restoredMedia, `${id}.display`));
      await stat(join(restoredMedia, `${id}.info`));
    }
    for (const database of databases) {
      const temporaryName = `${database.database}_restore_${randomBytes(4).toString('hex')}`;
      await run('docker', ['exec', database.container, 'createdb', '-U', database.role, '-T', 'template0', temporaryName]);
      temporaryNames.set(database.name, temporaryName);
      await streamRestore(pair[database.name], database, temporaryName);
      const count = await run('docker', [
        'exec', database.container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', database.role,
        '-d', temporaryName, '-tAc', `SELECT count(*) FROM ${database.table};`
      ]);
      assert.match(count.trim(), /^\d+$/);
      if (database.name === 'identity-db') {
        const realmCount = await run('docker', [
          'exec', database.container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', database.role,
          '-d', temporaryName, '-tAc', "SELECT count(*) FROM realm WHERE name = 'kaordo';"
        ]);
        assert.equal(realmCount.trim(), '1', 'Restored Keycloak database must contain the Kaordo realm');
      }
    }
    const appSubjects = await run('docker', [
      'exec', 'local-app-db-1', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'kaordo',
      '-d', temporaryNames.get('app-db'), '-tAc', 'SELECT keycloak_sub FROM users;'
    ]);
    const identitySubjects = await run('docker', [
      'exec', 'local-identity-db-1', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'keycloak',
      '-d', temporaryNames.get('identity-db'), '-tAc',
      "SELECT id FROM user_entity WHERE realm_id = (SELECT id FROM realm WHERE name = 'kaordo');"
    ]);
    const identities = new Set(identitySubjects.trim().split('\n').filter(Boolean));
    for (const subject of appSubjects.trim().split('\n').filter(Boolean)) {
      assert.ok(identities.has(subject), 'A restored account has no matching Keycloak identity');
    }
  } finally {
    for (const database of databases) {
      const temporaryName = temporaryNames.get(database.name);
      if (temporaryName) await run('docker', ['exec', database.container, 'dropdb', '-U', database.role, temporaryName]);
    }
    await rm(mediaRestore, { recursive: true, force: true });
  }
  console.log(`Encrypted backup and disposable restore verified: ${runTag.slice(4)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'backup') await backupLocal();
    else if (process.argv[2] === 'verify') await verifyLocalBackup();
    else throw new Error('Usage: node scripts/local-backup.mjs backup|verify');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
