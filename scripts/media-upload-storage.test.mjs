import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadStorage } from '../packages/media-client/src/tus-storage.ts';

const id = '0199a0c4-5a5f-7000-8000-000000000001';

test('saved HTTP tus URLs are upgraded to HTTPS for the same Nodo host', async () => {
  const removed = [];
  const old = {
    size: 1, metadata: {}, creationTime: '', urlStorageKey: 'old', parallelUploadUrls: null,
    uploadUrl: `http://kaordo.link/v1/uploads/${id}`
  };
  const foreign = { ...old, urlStorageKey: 'foreign', uploadUrl: `http://attacker.example/v1/uploads/${id}` };
  const malformed = { ...old, urlStorageKey: 'malformed', uploadUrl: 'bad-url' };
  const storage = {
    findAllUploads: async () => [old, foreign, malformed],
    findUploadsByFingerprint: async () => [old, foreign, malformed],
    removeUpload: async (key) => { removed.push(key); },
    addUpload: async () => 'new'
  };
  const safe = uploadStorage('https://kaordo.link', storage);
  const resumed = await safe.findUploadsByFingerprint('image');
  assert.deepEqual(resumed.map((upload) => upload.uploadUrl), [`https://kaordo.link/v1/uploads/${id}`]);
  assert.deepEqual(removed, ['foreign', 'malformed']);
  assert.equal(await safe.addUpload('image', old), 'new');
});

test('valid HTTP localhost uploads remain resumable in local development', async () => {
  const upload = {
    size: 1, metadata: {}, creationTime: '', urlStorageKey: 'local', parallelUploadUrls: null,
    uploadUrl: `http://127.0.0.1:8082/v1/uploads/${id}`
  };
  const safe = uploadStorage('http://127.0.0.1:8082', {
    findAllUploads: async () => [upload],
    findUploadsByFingerprint: async () => [upload],
    removeUpload: async () => { throw new Error('valid upload must not be discarded'); },
    addUpload: async () => 'new'
  });
  assert.deepEqual(await safe.findUploadsByFingerprint('image'), [upload]);
});
