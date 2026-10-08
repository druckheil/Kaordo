# Chat client

Owns the shared Ligo/Rondo conversation query, live subscription, outgoing
attachment workflow and message mutations. TanStack Query owns server state;
`api-client` owns HTTP/SSE and immutable cache updates; `media-client` owns Uppy
uploads. Pending messages preserve their client IDs and completed attachment IDs
when retried. Components render this state and own their draft and selection.

Each app supplies its selected conversation and optional related-query
invalidation. The app disposes the conversation state before clearing its query
client. This package has no dependency on app routes or chat components.
