# Kaordo crypto

Device-held account keys, signed shared-content envelopes, encrypted attachment
bytes, root-derived private data/indexes, and offline recovery. Uses the pinned
libsodium wrapper, Web Crypto and IndexedDB through `idb`; no server escrow key.
`session.ts` owns abortable in-memory account keys and decrypted object URLs.
`validation.ts` bounds and authenticates wire formats before they enter products.

Import browser cryptographic operations through this package; application
authorization and audience lookup belong to Kerno/API clients. UI belongs to
`account-ui`. Read the [key lifecycle and threat model](../../docs/encryption.md)
before changing formats, pinning, recipient grants, storage or recovery behavior.
Never log secrets, plaintext payloads, wrapped device records or recovery files.
