# Fluo

Independent SvelteKit social app. After the shared Kaordo account gate, it offers a Tiptap JSON composer, public and private posts, photo/video attachments, comments, quotes, good/bad reactions, follows, post search, profiles, and per-account private saved-post lists. The left navigation links Feed, Search, Notifications, Saved, Profile, and Settings; the feed is filtered by Latest or Following, while a user's own posts appear on their profile. TanStack Query caches cursor pages; TanStack Virtual renders only visible feed cards. The initial feed order is reverse chronological so a single-user installation has useful behavior without fabricated engagement data.

`@kaordo/api-client` owns typed Kerno requests and pagination policy. `@kaordo/media-client` resizes large images with Pica, uploads through Uppy/Tus to Nodo, and waits for validated media metadata before a post is created. PhotoSwipe handles still images and Vidstack handles processed MP4. All display text is rendered from safe structured Tiptap JSON without injecting user HTML.

Tiptap FileHandler attaches pasted photos, screenshots, and videos when the browser exposes them as clipboard files. Pasting shares the media picker's supported formats, four-file limit, previews, descriptions, and upload path. Text paste remains handled by Tiptap; draft editing is disabled while publishing.

## Profiles

Authenticated profile links use the unique, case-insensitive Kaordo username,
for example `/fluo/#profile/DruckHeil`. The account username is read-only in
Fluo; the nickname is independently editable and appears on posts, quoted posts,
notifications and follow lists. View mode shows the registration month, bio,
follower/following counts and only populated optional details: birth date,
location, website and pronouns. Counts open cursor-paginated account lists;
author names and avatars link to profiles. A profile's posts retain the existing
account and per-post access checks.

Edit mode keeps a local draft. The shared `ImageCropDialog` lazy-loads Cropper.js
for square avatars (512 × 512) and 3:1 banners (1500 × 500). Image input reuses
the existing JPEG/PNG/WebP size and decode limits. Crop previews remain local
until **Save changes**, which uses Uppy/Tus, Nodo's authoritative image metadata
and transactional media claims. Replacing or removing images retires files only
after their last post, message or profile reference disappears. Cancelling or
leaving editing aborts requests and releases local object URLs.

Owners choose Online, Busy or Invisible from the status menu. Shared account
avatars show availability at their corner across Fluo, Ligo and Rondo. Active
apps refresh a compact snapshot every two seconds; presence expires after
seven seconds without a foreground heartbeat.
Settings → Privacy controls status visibility for Everyone, Friends only
(mutual follows), or Nobody. Kerno filters presence before responding, never
exposes last-active timestamps, and returns the chosen raw status only to its
owner when visibility is not Nobody. Nobody removes the status menu even from
the owner's profile; Invisible hides every avatar indicator. Profile avatars
and banners open together in the existing PhotoSwipe viewer. Migration 018 assigns the initial
verified badge to the existing DruckHeil account; editable profile requests
cannot grant verification or change the registration date.

## Notifications

Notifications record likes, dislikes, direct replies, quotes and new followers from other accounts. Clicking a post notification opens the existing focused-post view and marks it read. Unread cards have a clickable bookmark strip flush with their right edge; it slides away after the server confirms reading and respects reduced motion. Read notifications cannot be made unread. **Mark all as read** appears only while the recipient has unread notifications and uses the displayed first page's boundary so newer activity remains unread. Its toolbar reserves the status and action row heights on desktop and narrow screens, keeping the list in place when the unread count changes. PostgreSQL owns every read timestamp. The navigation shows the unread count on desktop and in the mobile More control/menu. TanStack Query refreshes the latest page or the lighter unread summary every four seconds, leaving a margin within the five-second update target. Current activity renders independently of older cursor pages, which refresh every five minutes to renew media links and access state. Focus/reconnection also refresh state; hidden tabs do not poll.

Activity is recorded atomically with its originating action. Every notification kind shares a one-hour cooldown per recipient, actor, kind and destination post, measured from the previous emitted notification. Actual repeat actions within that hour are suppressed; after it, a new notification is appended without changing earlier read timestamps. Each new reply/quote has its own post ID and creates a separate notification immediately. Identical reaction/follow/visibility requests do not count as new actions. Self-actions, private quotes and private saved-post lists do not notify other accounts. Publishing a previously private reply/quote creates its notification. Accessible post previews are limited to 280 characters and include destination photo/video attachments in medium frames capped at 176 pixels high. Images load lazily; videos use a static black frame with a Play symbol and fetch no video bytes in Notifications. Preview clicks open the post, where the existing Vidstack player loads normally. Visibility checks apply to the destination and referenced post's ancestry. Deleted posts/accounts remove their notifications through foreign keys. Notifications start with activity performed after migration 014; older engagement is not backfilled. Migration 014 includes the cooldown lookup index.

The production static build is assembled by `pnpm build:pages:production` at the repository root.

## Code organization

`FluoApp` coordinates navigation and selected posts. `notification-state.svelte.ts` owns notification query lifecycles, cancellation and the shared read mutation. `profile-state.svelte.ts` owns profile queries and follow/status mutations; `profile-editor-state.svelte.ts` owns drafts, previews and save workflows. Their profile/editor components render controls, and `ProfileLink` delegates normal clicks to the app's SvelteKit navigation while preserving ordinary link behavior. `FluoFeed` owns feed query/rendering lifecycle; `FluoNotifications` renders activity and read controls; `FluoPageHeader` owns debounced search and section controls. Composer editor/model/publishing helpers separate text editing, validation and upload/publish flow from the dialog. Post actions, replies and quote preview are separate components. Advanced composer controls open explicitly, never merely because the user types.

Post detail uses SvelteKit `pushState`/`replaceState` and validates return destinations. Within the running app nested quotes return through browser history; after a document reload with no restored app return state, closing returns to Feed. URL and dialog state stay synchronized. Feed position is retained while reading a quoted post. Media dimensions are applied before decoded images load. `pnpm test:product:ui` checks reload/Escape/reopen, nested quotes, search and composing; the live test checks real persistence and uploads. See [refactor evidence](../../docs/refactoring.md).
