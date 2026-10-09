# Content encryption, devices and recovery

## Current scope

User content is encrypted on the device before upload: Fluo posts, replies,
quotes and their attachments; Ligo and Rondo messages, attachments, group titles
and community/channel names; Lingvo dictionaries and learning history; Memoro
days and media; and Rondo LiveKit calls. Kerno enforces authorization,
membership and revision checks on ciphertext; Nodo stores opaque bytes. There is
no administrator escrow key, content-access case or recovery override.

Fluo profiles (nickname, avatar, banner, bio, birth date, location, website and
pronouns) are public account presentation and are stored in clear, like
usernames. Content made public — public posts of a public account and public
communities — is readable by anyone who can see it, including the server
operator.

Production adopted this model on 2026-10-09 by recreating the application database
and media once; Keycloak accounts remained. Any backup taken before that date can
still contain plaintext and is an operator responsibility.

This is an implementation description, not a security certification.

## Signing in and approving a device

Normal sign-in continues to use Keycloak and OTP. No extra password is required.
The first browser creates an account encryption/signing key pair and a random
account root. Each browser generates its own device key pair, stored in IndexedDB
under a nonextractable Web Crypto key; this protects exported records, not a
compromised browser or OS account.

Kerno stores public identities and an account-key bundle sealed to each approved
device. A new browser can authenticate but cannot open private content until an
approved device signs its key transfer, or the user supplies a recovery key. On the
approved device open **Agordoj → Encryption & recovery** (the settings link in app
headers shows a count while a device waits), compare the 96-bit device fingerprint
on both devices, and approve only the intended device. Account
identities and previously encountered peer keys are pinned locally; an unexpected
key change fails closed rather than resetting the account.

Removing a device binding prevents that binding from reopening keys through the
API. It cannot erase a key or content previously copied by that device. Signing
out aborts key-scoped requests, clears caches, zeros live key buffers and revokes
decrypted object URLs.

## Recovery after losing every device

1. On an approved device, open **Agordoj → Encryption & recovery** and create a
   recovery key. A random 256-bit secret is generated locally. The page warns while
   no recovery key is active.
2. Save the displayed secret or download its JSON file to a separate secure
   location, confirm it, then activate recovery.
3. After losing all devices, sign in normally on a new browser and choose
   **Use a recovery key**. The browser opens the server's sealed account bundle
   locally and approves itself.

The secret is never sent to Kerno; the server holds only the sealed bundle.
Replacing recovery invalidates the old secret for the current server bundle, not
copies of an earlier bundle. Losing every approved device **and** the recovery
secret makes private content unrecoverable. Recovery restores keys, not deleted
server data; RAID1 is not a backup.

## Fluo audience keys

Each author has versioned audience keys derived on their devices from the
account root, so every device of the author can recompute them:

- A **public account** publishes its key versions; anyone (and the server) can
  read the posts, as with any public post.
- A **private account** seals its current version to each account it follows.
  The author's device delivers these sealed copies when it follows someone, when
  privacy changes and whenever Fluo opens (for accounts that created their device
  identity later).
- Switching public → private rotates to a new unpublished version for new posts.
  Switching private → public publishes every version, so earlier posts become
  visible without re-encryption. Unfollowing deletes that account's sealed copies;
  access to posts is also enforced by Kerno.
- **Only me** posts use version 0, which is never stored or shared. Making one
  public re-encrypts it on the author's device; one with replies cannot be made
  public. Hiding a public post only changes access, because its audience could
  already read it.

A post's content key is derived from the sorted keys of its author and of every
other author in its reply lineage. A reader therefore needs each audience key in
the thread, matching Kerno's intersection of ancestor policies. Kerno verifies the
author's signature, the current key version and the inherited lineage keys, but
never receives unpublished key material in clear.

## Cryptographic ownership

| Data                            | Representation and owner                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Account encryption/signing keys | libsodium X25519/Ed25519, created on a device                                             |
| Device/recovery account bundle  | libsodium sealed box; account ID and public keys checked after opening                    |
| Fluo posts                      | Signed XChaCha20-Poly1305 envelope; HKDF content key over the thread's audience keys      |
| Fluo audience keys              | HKDF from the account root; published, or sealed to followed accounts                     |
| Ligo/Rondo content              | Signed XChaCha20-Poly1305 envelope; per-record key sealed to current members              |
| Attachments                     | AES-256-GCM bytes; key, filename, type, dimensions and alt text inside the signed content |
| Lingvo/Memoro private content   | Account-root HKDF-derived AES-GCM keys; HMAC-derived opaque indexes                       |
| LiveKit tracks                  | SDK E2EE key provider and worker; channel-member encrypted room key                       |

Ligo and Rondo messages are sealed to members at send time, so accounts added
later see earlier messages as unavailable. LiveKit E2EE disables Opus RED and,
on Safari/iOS before 17.2, simulcast; calls are less resilient to packet loss than
unencrypted calls. Membership changes rotate the room key through the next active
client. None of this is a ratchet, MLS deployment or forward-secrecy guarantee.

Clients never display unencrypted or unverifiable post/message content; it renders
as unavailable. Administrator system notices are the only plaintext messages.

Images open as their views approach the viewport; videos and files open on
request. Mounted thumbnails, viewers and download actions share decrypted bytes;
the last consumer releases the object URL and cancels unfinished work. Query
caches retain attachment descriptors, not decrypted media bytes. Fluo search
checks at most three encrypted feed pages per step; **Search older posts** continues
from the returned cursor without sending search text to Kerno.

## What the server can still observe

User/account identifiers, usernames, profiles, authentication, access policies,
membership/follow relationships, interaction counts, receipts, presence,
timestamps, ciphertext sizes and attachment IDs remain server-visible. Post and
message search runs on the device. Memoro date indexes and summaries and Lingvo
contents/schedules are opaque. This does **not** encrypt 100% of metadata.

## Threat model and limits

The scheme protects private stored ciphertext from a database/media reader,
application administrator and passive server operator without device or recovery
keys. **An operator who can replace the delivered web application can steal keys
or plaintext when it runs.** Initial key-directory and membership trust also
depends on the server; local pinning detects changes after first contact. The
scheme does not protect against compromised devices, recipient copies or
screenshots, or provide cryptographic deletion of keys already shared.

## Code map

- `packages/crypto`: keys, device storage, content/audience envelopes, private data, media and recovery
- `packages/account-ui`: unlock/approval/recovery UI and key-session lifecycle
- `packages/api-client`: codecs, Fluo audience-key reconciliation and verified audiences
- `packages/lingvo-client`: private dictionary transactions and FSRS
- `packages/memoro-client`: day/index/media validation and encryption
- `services/kerno/internal/encryption`, `memoro`, `vault`: consumer contracts and envelope validation
- `services/kerno/internal/httpapi` and `postgres`: owner checks, signed proofs,
  keyring and recipient validation, claims and CAS persistence
- `scripts/encryption-fixture.mjs`: deterministic synthetic accounts that seed and verify test ciphertext

Primary references: [libsodium sealed boxes](https://libsodium.gitbook.io/doc/public-key_cryptography/sealed_boxes),
[libsodium.js](https://github.com/jedisct1/libsodium.js),
[LiveKit E2EE](https://docs.livekit.io/transport/encryption/start/) and
[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).
