// Owns deterministic synthetic account keys so browser fixtures can seed, serve and verify device-encrypted data
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import sodium from 'libsodium-wrappers';

await sodium.ready;
const sharedPrefix = 'kaordo:e2ee:v1:';
const postPrefix = 'kaordo:fluo:v1:';
const encode = bytes => Buffer.from(bytes).toString('base64');
const decode = value => new Uint8Array(Buffer.from(value, 'base64'));
const utf8 = value => new TextEncoder().encode(value);
const hkdf = (key, salt, info) => new Uint8Array(hkdfSync('sha256', key, utf8(salt), utf8(info), 32));
// A 6×4 PNG keeps encrypted fixture images decodable with the 3:2 proportions used by layout tests
const png = decode('iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAEUlEQVR4nGMIbypDQwzkCgEApxAfadR8kEUAAAAASUVORK5CYII=');

const accounts = new Map();
/** Synthetic account keys derived from the account ID; never use outside fixtures */
export function syntheticAccount(id) {
  let account = accounts.get(id);
  if (!account) {
    const seed = createHash('sha256').update(`kaordo-fixture-account:${id}`).digest();
    account = { id, root: new Uint8Array(createHash('sha256').update(seed).update('root').digest()),
      encryption: sodium.crypto_box_seed_keypair(seed), signing: sodium.crypto_sign_seed_keypair(seed) };
    accounts.set(id, account);
  }
  return account;
}
export function publicIdentity(id) {
  const account = syntheticAccount(id);
  return { id, encryptionPublicKey: encode(account.encryption.publicKey), signingPublicKey: encode(account.signing.publicKey) };
}
export const audienceKey = (ownerId, version) => hkdf(syntheticAccount(ownerId).root, ownerId, `kaordo/v1/fluo-audience/${version}`);

// Encrypts bytes exactly like a browser attachment and returns the opaque wire item plus its private descriptor
export function encryptedImage({ id, altText = '', width = 960, height = 640 }) {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const context = id;
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  const bytes = Buffer.concat([Buffer.from('Kaordo01'), nonce, cipher.update(png), cipher.final(), cipher.getAuthTag()]);
  return {
    wire: { id, kind: 'file', mimeType: 'application/octet-stream', width: 0, height: 0, size: bytes.length, altText: '',
      url: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
    descriptor: { id, kind: 'image', mimeType: 'image/png', filename: `${id}.png`, width, height, size: png.length, altText, key: key.toString('base64'), context },
  };
}
export function openFixtureMedia(data, descriptor) {
  assert.equal(data.subarray(0, 8).toString(), 'Kaordo01');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(descriptor.key, 'base64'), data.subarray(8, 20));
  decipher.setAAD(Buffer.from(descriptor.context)); decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(20, -16)), decipher.final()]);
  assert.equal(plain.length, descriptor.size);
  return plain;
}

// Fluo posts: content key derived from every audience key in the sorted keyring
const refLines = keyring => keyring.map(ref => `${ref.ownerId}:${ref.version}`);
function postKey(context, keyring, keyFor = ref => audienceKey(ref.ownerId, ref.version)) {
  const joined = Buffer.concat(keyring.map(keyFor));
  return new Uint8Array(hkdfSync('sha256', joined, utf8(context), utf8(['kaordo-keyring-v1', ...refLines(keyring)].join('\n')), 32));
}
const postSignature = envelope => utf8(['kaordo-keyring-v1', envelope.context, envelope.senderId, envelope.nonce, envelope.ciphertext, ...refLines(envelope.keyring)].join('\n'));
export function sealPost(authorId, postId, body, keyring = [{ ownerId: authorId, version: 1 }]) {
  const sorted = [...keyring].sort((a, b) => a.ownerId < b.ownerId ? -1 : 1);
  const context = `fluo:${postId}`;
  const nonce = sodium.randombytes_buf(24);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8(JSON.stringify(body)), utf8(context), null, nonce, postKey(context, sorted));
  const envelope = { version: 1, context, senderId: authorId, nonce: encode(nonce), ciphertext: encode(ciphertext), keyring: sorted };
  return { ...envelope, signature: encode(sodium.crypto_sign_detached(postSignature(envelope), syntheticAccount(authorId).signing.privateKey)) };
}
export function openPost(value) {
  const envelope = typeof value === 'string' ? JSON.parse(value.slice(postPrefix.length)) : value;
  assert.ok(sodium.crypto_sign_verify_detached(decode(envelope.signature), postSignature(envelope), syntheticAccount(envelope.senderId).signing.publicKey), 'The fixture validates the post signature');
  const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(envelope.ciphertext), utf8(envelope.context), decode(envelope.nonce), postKey(envelope.context, envelope.keyring));
  return JSON.parse(new TextDecoder().decode(plain));
}
export const postText = envelope => postPrefix + JSON.stringify(envelope);
/** Opens a live public post with keys published by the server, as any reader could */
export function openPublishedPost(value, signingPublicKey, publishedKeys) {
  const envelope = typeof value === 'string' ? JSON.parse(value.slice(postPrefix.length)) : value;
  assert.ok(sodium.crypto_sign_verify_detached(decode(envelope.signature), postSignature(envelope), decode(signingPublicKey)), 'The live post signature verifies');
  const key = postKey(envelope.context, envelope.keyring, ref => {
    const published = publishedKeys.find(item => item.ownerId === ref.ownerId && item.version === ref.version)?.publicKey;
    assert.ok(published, 'Every key protecting a public post is published');
    return decode(published);
  });
  const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(envelope.ciphertext), utf8(envelope.context), decode(envelope.nonce), key);
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Converts a readable fixture post into the opaque wire form a server would return */
export function encryptedPost(post, { keyring, images = [] } = {}) {
  const media = images.map(encryptedImage);
  const body = { content: post.content, text: post.text, media: media.map(item => item.descriptor), parentId: post.parentId ?? null, quoteId: post.quoteId ?? null };
  const content = sealPost(post.author.id, post.id, body, keyring);
  const quote = post.quote && { ...post.quote, text: post.quote.content ? postText(post.quote.content) : post.quote.text, media: post.quote.media ?? [] };
  return { ...post, content, text: postText(content), media: media.map(item => item.wire), quote };
}

// Ligo and Rondo content: per-record key sealed to each member
const sharedSignature = envelope => utf8(['kaordo-content-v1', envelope.context, envelope.senderId, envelope.nonce, envelope.ciphertext, envelope.publicKey,
  ...[...envelope.keys].sort((a, b) => a.userId.localeCompare(b.userId)).map(item => `${item.userId}:${item.key}`)].join('\n'));
export function sealShared(senderId, context, value, recipientIds) {
  const key = sodium.randombytes_buf(32);
  const nonce = sodium.randombytes_buf(24);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8(JSON.stringify(value)), utf8(context), null, nonce, key);
  const keys = [...new Set([senderId, ...recipientIds])].map(userId => ({ userId, key: encode(sodium.crypto_box_seal(key, syntheticAccount(userId).encryption.publicKey)) }));
  const envelope = { version: 1, context, senderId, nonce: encode(nonce), ciphertext: encode(ciphertext), keys, publicKey: '' };
  return { ...envelope, signature: encode(sodium.crypto_sign_detached(sharedSignature(envelope), syntheticAccount(senderId).signing.privateKey)) };
}
export const sharedText = envelope => sharedPrefix + JSON.stringify(envelope);
export function openShared(value) {
  const envelope = typeof value === 'string' ? JSON.parse(value.slice(sharedPrefix.length)) : value;
  assert.ok(sodium.crypto_sign_verify_detached(decode(envelope.signature), sharedSignature(envelope), syntheticAccount(envelope.senderId).signing.publicKey), 'The fixture validates the sender signature');
  const key = envelope.publicKey ? decode(envelope.publicKey) : (() => {
    const { encryption } = syntheticAccount(envelope.keys[0].userId);
    return sodium.crypto_box_seal_open(decode(envelope.keys[0].key), encryption.publicKey, encryption.privateKey);
  })();
  const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(envelope.ciphertext), utf8(envelope.context), decode(envelope.nonce), key);
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Converts a readable chat message into the member-sealed wire form */
export function encryptedMessage(message, memberIds, images = []) {
  const media = images.map(encryptedImage);
  const envelope = sealShared(message.sender.id, `ligo:${message.conversationId}:${message.clientId}`, { text: message.text, media: media.map(item => item.descriptor) }, memberIds);
  return { ...message, text: sharedText(envelope), media: media.map(item => item.wire) };
}
/** Seals community and channel names for their members, signed by the community owner */
export function encryptedCommunity(server, channels, memberIds) {
  return {
    server: { ...server, name: sharedText(sealShared(server.ownerId, `rondo:${server.id}`, { name: server.name, description: server.description }, memberIds)), description: '' },
    channels: channels.map(channel => ({ ...channel, name: sharedText(sealShared(server.ownerId, `rondo-channel:${server.id}:${channel.id}`, { name: channel.name }, memberIds)) })),
  };
}

// Owner-only records such as Lingvo dictionaries: HKDF-derived AES-GCM data keys and HMAC tags
export function privateRecords(ownerId, module) {
  const { root } = syntheticAccount(ownerId);
  const dataKey = hkdf(root, ownerId, `kaordo/v1/${module}/data`);
  const indexKey = hkdf(root, ownerId, `kaordo/v1/${module}/index`);
  const aad = id => Buffer.from(`kaordo/v1/${module}/${ownerId}/${id}`);
  const tag = id => createHmac('sha256', indexKey).update(id).digest('hex');
  return {
    tag,
    seal(id, value, revision = 1) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
      cipher.setAAD(aad(id));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
      return { tag: tag(id), revision, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64') };
    },
  };
}

function deviceBundle(ownerId, devicePublicKey) {
  const account = syntheticAccount(ownerId);
  const bundle = utf8(JSON.stringify({ version: 1, ownerId, root: encode(account.root),
    encryptionPublicKey: encode(account.encryption.publicKey), encryptionPrivateKey: encode(account.encryption.privateKey),
    signingPublicKey: encode(account.signing.publicKey), signingPrivateKey: encode(account.signing.privateKey) }));
  return encode(sodium.crypto_box_seal(bundle, decode(devicePublicKey)));
}

const states = new WeakMap();
/**
 * Serves the encryption API for one synthetic owner per browser context.
 * The owner's account already exists, so each new browser device is approved as if by another device.
 */
export function encryptionFixture(request, accountList, viewerId, { privacy, records = [] } = {}) {
  const context = request.frame().page().context();
  let state = states.get(context);
  if (!state) {
    state = { ownerId: viewerId, devices: [], versions: [], records: new Map(records.map(item => [item.tag, structuredClone(item)])), recovery: null };
    states.set(context, state);
  }
  assert.equal(state.ownerId, viewerId, 'A browser context owns one synthetic encryption account');
  const declared = new Set(accountList.map(account => account.id));
  return { response: () => encryptionResponse(request, state, declared, privacy) };
}

function keyringState(state, privacy) {
  return { accountVisibility: privacy?.accountVisibility ?? 'public', versions: state.versions.map(item => ({ ...item })), missing: [] };
}

function encryptionResponse(request, state, declared, privacy) {
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  const identity = () => ({ ...publicIdentity(state.ownerId), devices: state.devices });
  if (path === '/v1/crypto/identity') return { identity: identity() };
  if (path === '/v1/crypto/devices' && method === 'POST') {
    const input = request.postDataJSON();
    assert.ok(!input.wrappedKeys, 'The synthetic account already exists, so new devices only register their public key');
    state.devices.push({ id: input.id, publicKey: input.publicKey, wrappedKeys: deviceBundle(state.ownerId, input.publicKey), createdAt: new Date().toISOString() });
    return identity();
  }
  if (path.startsWith('/v1/crypto/users/')) {
    const id = path.split('/').at(-1);
    assert.ok(declared.has(id), 'Only declared synthetic accounts have encryption identities');
    return publicIdentity(id);
  }
  if (path.startsWith('/v1/crypto/audience/')) {
    assert.ok(['ligo', 'ligo-history', 'rondo'].includes(path.split('/')[4]));
    return { public: false, users: [...declared].map(publicIdentity) };
  }
  if (path === '/v1/crypto/recovery') {
    if (method === 'PUT') { state.recovery = request.postDataJSON().wrappedKeys; return { wrappedKeys: state.recovery }; }
    return { wrappedKeys: state.recovery };
  }
  if (path === '/v1/crypto/records/read') {
    const { tags } = request.postDataJSON();
    return { items: tags.flatMap(tag => state.records.has(tag) ? [structuredClone(state.records.get(tag))] : []) };
  }
  if (path === '/v1/crypto/records/commit') {
    const { writes, deletes } = request.postDataJSON();
    assert.ok(writes.length + deletes.length > 0 && writes.length + deletes.length <= 502);
    const tags = new Set();
    for (const item of [...writes, ...deletes]) {
      assert.match(item.tag, /^[0-9a-f]{64}$/);
      assert.ok(!tags.has(item.tag), 'A ciphertext transaction has unique tags'); tags.add(item.tag);
      assert.equal(state.records.get(item.tag)?.revision ?? 0, item.revision, 'Ciphertext writes preserve CAS revisions');
    }
    const items = writes.map(item => {
      assert.equal(decode(item.nonce).length, 12);
      assert.ok(decode(item.ciphertext).length >= 16, 'Opaque records contain authenticated ciphertext');
      const record = { ...item, revision: item.revision + 1 };
      state.records.set(item.tag, record); return structuredClone(record);
    });
    for (const item of deletes) state.records.delete(item.tag);
    return { items };
  }
  if (path === '/v1/fluo/keyring' && method === 'GET') return keyringState(state, privacy);
  if (path === '/v1/fluo/keyring' && method === 'POST') {
    const input = request.postDataJSON();
    if (input.create) {
      assert.equal(input.create, state.versions.length + 1, 'Audience key versions are created in order');
      state.versions.push({ version: input.create, published: false });
    }
    for (const item of input.publish) {
      assert.equal(item.key, encode(audienceKey(state.ownerId, item.version)), 'A published audience key matches the account root derivation');
      state.versions.find(version => version.version === item.version).published = true;
    }
    return keyringState(state, privacy);
  }
  if (path === '/v1/fluo/keys') {
    // Other synthetic accounts are public; the owner's keys are served only after this device publishes them.
    const items = url.searchParams.get('refs').split(',').map(value => value.split(':')).flatMap(([ownerId, version]) => {
      const published = ownerId !== state.ownerId || state.versions.some(item => item.version === Number(version) && item.published);
      return declared.has(ownerId) && published ? [{ ownerId, version: Number(version), publicKey: encode(audienceKey(ownerId, Number(version))) }] : [];
    });
    return { items };
  }
}
