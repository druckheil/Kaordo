# Memoro

Memoro is the private calendar, task list and journal at `/memoro/`.
On desktop, the calendar and selected day's tasks share two equal columns;
the daily journal spans the row below. Narrow screens stack the sections.
The shared Bits UI calendar supports keyboard date selection and month navigation.
The selected date is synchronized with the SvelteKit URL.

Category colors use dots beneath dates: one/two, triangle, square and polygon
clusters up to eight dots, followed by an overflow count. A hollow marker indicates
a journal entry. Accessible day labels include task counts and journal presence.
Categories have textual names so color is not the only cue.

The plus button adds a task. Choose a category, write formatted text, attach
images/videos from selection, drop or clipboard, and optionally choose status/time.
Task details and the journal reuse `editor-ui`'s Tiptap, formatting controls,
attachment drafts and the established media components. Time belongs to the
selected calendar date; there is no reminder/notification service in this scope.

The journal saves automatically after a short pause in editing and before
another day or app opens; text typed during a save is kept for the next one.
Tasks save when added, edited, completed or deleted, and only an unsaved task
draft asks before it is discarded. A failed save keeps the user on the day and
waits for the next edit, and a failed load does not expose a blank editable
replacement. A conflicting save asks the user
to reload rather than overwriting another device. A failed task save retains its
draft and does not silently change the journal's task list.

`memoro-state.svelte.ts` owns selection, requests, drafts, upload/save and disposal.
Panels/dialogs own presentation. `packages/memoro-client` validates the daily
document, encrypts it and its index/summary, and opens media. Kerno stores opaque
month/day tags, ciphertext and revisions, and claims media within the day-save
transaction. Dates, task text, categories and journal content are not cleartext
database columns. Image previews decrypt on the device; video bytes load on demand.
Unmounting/locking cancels requests and revokes decrypted URLs.

Each entry supports up to four media files and a day up to 32. Files are bounded
to 99 MiB; the encrypted day is bounded to 2 MiB. Calendar summaries contain task
colors and journal presence inside encryption, not plaintext event descriptions.
There are no custom category definitions, recurring tasks or offline-write queue.

Sign in and open `http://localhost:8765/memoro/`. Restart an older `pnpm dev`
process after adding this app. The launcher applies migrations and starts Memoro
on loopback port 18771. Static builds and the release verifier include its route.
See [device approval, recovery and security boundaries](../../docs/encryption.md).
