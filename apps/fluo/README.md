# Fluo

Independent SvelteKit social app. After the shared Kaordo account gate, it offers a Tiptap JSON composer, public and private posts, photo/video attachments, comments, quotes, good/bad reactions, follows, post search, profiles, and per-account private saved-post lists. The left navigation links Feed, Search, Notifications, Saved, Profile, and Settings; the feed is filtered by Latest or Following, while a user's own posts appear on their profile. TanStack Query caches cursor pages; TanStack Virtual renders only visible feed cards. The initial feed order is reverse chronological so a single-user installation has useful behavior without fabricated engagement data.

`@kaordo/api-client` owns typed Kerno requests and pagination policy. `@kaordo/media-client` resizes large images with Pica, uploads through Uppy/Tus to Nodo, and waits for validated media metadata before a post is created. PhotoSwipe handles still images and Vidstack handles processed MP4. All display text is rendered from safe structured Tiptap JSON without injecting user HTML.

The production static build is assembled by `pnpm build:pages:production` at the repository root.

## Code organization

`FluoApp` coordinates navigation, selected post and mutations. `FluoFeed` owns query/rendering lifecycle; `FluoPageHeader` owns debounced search and section controls. Composer editor/model/publishing helpers separate text editing, validation and upload/publish flow from the dialog. Post actions, replies and quote preview are separate components. Advanced composer controls open explicitly, never merely because the user types.

Post detail uses SvelteKit `pushState`/`replaceState` and validates return destinations. Within the running app nested quotes return through browser history; after a document reload with no restored app return state, closing returns to Feed. URL and dialog state stay synchronized. Feed position is retained while reading a quoted post. Media dimensions are applied before decoded images load. `pnpm test:product:ui` checks reload/Escape/reopen, nested quotes, search and composing; the live test checks real persistence and uploads. See [refactor evidence](../../docs/refactoring.md).
