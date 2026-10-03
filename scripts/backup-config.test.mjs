import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { latestPair } from './local-backup.mjs';

const snapshot = (id, run, database) => ({ id, tags: ['kaordo-local', `run:${run}`, database] });

test('backup selection ignores an incomplete newer run', () => {
  const [run, pair] = latestPair([
    snapshot('old-app', '202609290900', 'app-db'),
    snapshot('new-app', '202609291000', 'app-db'),
    snapshot('old-identity', '202609290900', 'identity-db'),
    snapshot('old-media', '202609290900', 'media')
  ]);
  assert.equal(run, 'run:202609290900');
  assert.equal(pair['app-db'].id, 'old-app');
  assert.equal(pair['identity-db'].id, 'old-identity');
  assert.equal(pair.media.id, 'old-media');
});

test('backup selection never mixes database snapshots from separate runs', () => {
  assert.throws(() => latestPair([
    snapshot('app', '202609290900', 'app-db'),
    snapshot('identity', '202609291000', 'identity-db')
  ]), /No complete local backup set/);
});

test('backup selection chooses the newest complete pair', () => {
  const [run] = latestPair([
    snapshot('old-app', '202609290900', 'app-db'),
    snapshot('old-identity', '202609290900', 'identity-db'),
    snapshot('old-media', '202609290900', 'media'),
    snapshot('new-app', '202609291000', 'app-db'),
    snapshot('new-identity', '202609291000', 'identity-db'),
    snapshot('new-media', '202609291000', 'media')
  ]);
  assert.equal(run, 'run:202609291000');
});

test('backup CLI rejects repository and key paths inside the source tree', () => {
  for (const [repository, passwordFile] of [
    ['./backups', '/tmp/kaordo-backup-key'],
    ['/tmp/kaordo-restic', './deploy/local/.env']
  ]) {
    const result = spawnSync(process.execPath, ['scripts/local-backup.mjs', 'backup'], {
      env: { ...process.env, RESTIC_REPOSITORY: repository, RESTIC_PASSWORD_FILE: passwordFile },
      encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the Kaordo source tree/);
  }
});
