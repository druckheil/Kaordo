# Ligo

Independent SvelteKit messenger at `/ligo/`. Sign in through the shared Keycloak account, then use Saved messages, find another user by username, or create a group. Direct chats are unique per pair; group creators can invite members. New members see messages sent after they join.

Kerno owns conversation and message metadata in PostgreSQL. Nodo owns uploaded bytes and tus processing. A message can contain text and up to eight photos, videos, or files. Message text appears below attachments; the composer has one text field and no separate caption input. Its `clientId` makes retries idempotent. Messages support author edits and deletion, heart/like/dislike reactions, and sent/delivered/read receipts. Delivery means the recipient's visible browser acknowledged the newest message in the conversation; read means the conversation was open and visible. In groups, the status advances when every member eligible to receive that message acknowledges it. Read cursors, message history, and the conversation list use server pagination. Ligo listens for authenticated change hints over SSE and reloads authorized state through TanStack Query. Older history is virtualized in the browser; sends appear locally while uploads and delivery finish. The message view loads when a conversation opens. Media uses the shared PhotoSwipe and Vidstack components in a compact grid. The composer previews selected media and expands with text up to a bounded height.

This implementation does not provide end-to-end encryption or push notifications. Do not describe it as a secure messenger. The documented Synapse instance is not part of this running slice.

Run `pnpm dev` at the repository root. The static production frontend is assembled by `pnpm build:pages`.
