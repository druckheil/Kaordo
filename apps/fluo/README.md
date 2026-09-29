# Fluo

Independent SvelteKit social app. After the shared Kaordo account gate, it offers a Tiptap JSON composer, public and private posts, photo/video attachments, comments, quotes, good/bad reactions, follows, post search, profiles, and per-account private saved-post lists. The left navigation links Feed, Search, Notifications, Saved, Profile, and Settings; the feed is filtered by Latest or Following, while a user's own posts appear on their profile. TanStack Query caches cursor pages; TanStack Virtual renders only visible feed cards. The initial feed order is reverse chronological so a single-user installation has useful behavior without fabricated engagement data.

`@kaordo/api-client` owns typed Kerno requests and pagination policy. `@kaordo/media-client` resizes large images with Pica, uploads through Uppy/Tus to Nodo, and waits for validated media metadata before a post is created. PhotoSwipe handles still images and Video.js handles processed MP4. All display text is rendered from safe structured Tiptap JSON without injecting user HTML.

The production static build is assembled by the repository root `build:pages` command.
