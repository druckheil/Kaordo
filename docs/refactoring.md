# Refactor review — 3 October 2026

## Scope and outcome

Reviewed the accumulated, uncommitted maintainability refactor across all five apps, shared packages, four Go modules and repository scripts. The refactor preserves wire schemas and existing product workflows. Generated OpenAPI/Jet files, credentials, user content and build output are not refactor targets. No production deployment accompanies this change.

This is an engineering review with automated evidence, not a new ISO score or a claim that every possible device, browser and failure mode is bug free. Historical audit scores retain their dated scope.

## Ownership after refactoring

| Layer | Responsibility |
| --- | --- |
| Portal | Welcome/app entry/auth presentation; shared account controller handles the session |
| Fluo | Controller for selection/navigation/post actions; notification/settings query controllers and separate feed/header, settings, composer/editor/publishing, replies/detail |
| Ligo | Conversation selection and SSE/query coordination; separate sidebar and conversation dialog |
| Rondo | Server/channel coordination, member panel, layout helpers and voice views; shared chat pipeline |
| Regado | Independent query resources and mutations; overview/storage/system/users/audit/log panels and action/access dialogs |
| auth / account-ui | In-memory OIDC tokens; verified account bootstrap and nonauthorizing per-tab preview |
| api-client / contracts | Typed requests, response/refresh policy, query keys, pagination, cancellation and immutable message/Fluo cache helpers; generated wire schemas |
| ui / chat-ui | STaSBRL primitives and shared message/composer/native-scroll interaction |
| media-client / media-ui / voice-client | Upload/resize workflow; metadata-based layout, PhotoSwipe/Vidstack; LiveKit room/track lifecycle and sounds |
| Kerno | Configuration/wiring, HTTP authorization/orchestration, domain validation, Jet/pgx persistence split by operation |
| Nodo | HTTP upload/media handlers, owner/quota validation, processing queue, image/video/file processing, purge/GC and worker lifecycle |
| mediaauth / regado-agent | Media signatures; protected Unix API, fixed commands, host/Btrfs/SMART/journal queries |
| scripts | Local lifecycle/configuration, independent builds, fixture/live/database tests and isolated backup verification |

Keep transaction and authorization boundaries cohesive. Extra file splits or wrapper functions are useful only when they give a responsibility a clear owner. Shared libraries replace duplicated logic; app-specific views and selection remain in their app.

## Defects and architectural issues corrected in the final review

1. **Shared chat composer and cache updates.** Ligo/Rondo now consume one composer and immutable append/replace helpers, including idempotent sends and preserved pagination parameters. This removes two evolving implementations of the same interaction.
2. **Regado stale requests.** Replaced manual request-generation/loading coordination with TanStack Query resources keyed by tab/filter/case. Reads accept cancellation, case pagination has its own loading state, private case caches are discarded and app-owned clients clear on teardown. Opening a case no longer fetches/audits its first page twice.
3. **Typed administrator client.** Regado uses generated OpenAPI paths and parameter names (`q`, `before`) with the common response/error/204 policy.
4. **Graceful service shutdown.** Kerno/Nodo wait for active HTTP requests before dependencies close. Nodo owns cancellation and joining for processing/GC; FFmpeg follows that context and cancelled jobs remain eligible for restart. Occupied-port and active-request-drain tests cover the failure/stop paths.
5. **Fluo history ownership.** Post dialogs use SvelteKit shallow navigation APIs instead of overwriting router-owned native history state. Reload/Escape/reopen and nested quote tests keep the selected object, URL and visible dialog consistent. A fresh document without return context closes to Feed.
6. **Case-insensitive search.** Real integration testing found that Fluo/Regado lowered columns but not the pattern. Both now lower the parameter in PostgreSQL while preserving literal LIKE escaping; mixed-case database tests protect the fix.
7. **Lifecycle and presentation details.** Detail requests receive AbortSignal; app caches clear on teardown; panel storage failure is tolerated; delayed search callbacks cannot scroll another view; duplicate journal timestamps do not break keyed rendering. Log selectors have explicit accessible names.
8. **Verification and instructions.** Added Rondo membership/history/access database coverage, shared headless fixtures and product regressions. CI now covers all Go modules and fixture UI flows. Updated every tracked Markdown document and the technical specification; dated audits remain historical records.

## Verification

Commands run from the repository root unless specified. Headless browser tests operate through test code; no manual website exploration was used.

| Check | Evidence |
| --- | --- |
| `pnpm check:front` | Six Svelte projects: 0 errors, 0 warnings |
| `pnpm build:pages` / `scripts/pages.test.mjs` | All apps build independently and assemble; static routes/assets and Fluo initial JavaScript budget checked |
| `pnpm test:pages:production` | Production build overrides local `.env` service URLs and checks every emitted JavaScript bundle |
| Fast Node suites | Account previews/session races, API retry/error/cancellation/cache, Keycloak policy, backup config, dependency imports, launcher, tus storage and media/chat geometry |
| `pnpm test:product:db` | Disposable PostgreSQL; Fluo/Ligo/Rondo/Regado, migration replay, shared media claims and authorization; PostgreSQL package statement coverage 80.4% |
| Go race / vet / build | Kerno, Nodo, mediaauth and regado-agent; no failure |
| `pnpm --filter @kaordo/contracts generate` | Generated OpenAPI declarations remain unchanged |
| Fixture Chromium suites | Public screens, Fluo history/reply/quote/search, Ligo native scroll/composer, Regado views/stale requests/access cases and axe/reflow checks |
| `pnpm test:auth:live` | Real identity, TOTP/recovery, SSO/account, social/media/messages and Rondo calls/camera; temporary account cleanup |
| `pnpm test:backup:live` | Encrypted temporary restic repository, both database dumps, media restore and disposable cleanup |
| `pnpm audit --audit-level=low` | No known npm advisories reported |
| `govulncheck@v1.8.0` in all four Go modules | No reachable vulnerable symbol reported; Kerno's scan also identifies advisories in uncalled imported/required code. This is a reachability result, not absence of every transitive advisory |

Final fast suites: 106/106 passed, with no skips after stopping the development server. Headless suites: 4/4 passed (public, Fluo, Ligo, Regado). The live product journey and isolated backup restore each passed. PostgreSQL capacity fixtures also exercised 20,000 posts/100 authors and 10,000 messages; these local measurements are not production-scale guarantees.

## Remaining product and evidence boundaries

The 2026-10-04 Regado storage update adds explicit NixOS/root-disk attribution,
partition gaps, physical versus unique capacity, detached copy-check/repair
workers, and authenticated Nodo reference audits. New Go tests cover request
cancellation, simultaneous operations, distinct physical members, mixed and
degraded placement, every scrub member, preservation on unavailable/new
references, freshness rechecks, and administrator audit ordering. The Regado
fixture covers the new read-only and confirmed repair actions, copy ratios,
free regions, 320px reflow, and automated accessibility. Commands and deployment
evidence for this update are reported separately from the historical matrix.

Verified for this storage update: `pnpm check:front`, generated OpenAPI types,
`pnpm test:regado:ui`, `pnpm test:pages:production`, all four Go module race
suites, `go vet`, Linux amd64 builds, and the NixOS configuration build passed.
The explicitly authorized server update activated backend
`v0.0.2-e79441b35147-storage-20261004T123754Z-dirty` and frontend
`v0.0.2-e79441b35147-pages-20261004T124536Z-dirty`. Deployment initially rolled
back when a health probe preceded listener readiness; retry waited for health
endpoints and retained the previous binaries/configuration. On 2026-10-04 at
12:54:15 UTC, a real read-only check inventoried 6,306 regular pool files with
uniform redundant placement on two physical disks, passed checksums, and zero
unreadable paths. Nodo audited 20 media artifact files, with zero surplus,
unverified, or missing files. Root NixOS is `/dev/sdb2`; `/dev/sda` has a real
64 GiB unallocated region. All four application/proxy services were active and
unauthenticated public Regado API access returned 401. Repair and deletion
failure cases were verified with isolated tests, not destructive production
disk experiments.

## Declarative storage update — 4 October 2026

Regado now follows Host → physical device → partition → role, with stable
hardware identity and connection details. It separates useful free regions
from collapsed GPT/BIOS/EFI overhead. The role dialog previews sizes, exports
a Disko declaration and requires an audited reason, exact device confirmation
and a current geometry fingerprint. Obsolete previews are cancelled.

Disko 1.13.0 initializes verified blank devices. systemd-repart 260.4 handles
incremental allocation; btrfs-progs handles pool membership and online growth.
Native definitions preserve all existing partition starts and filesystems.
Existing System resizing, shrink, movement, deletion, OS installation and
service-state migration remain explicit offline operations. System data
volumes mount by UUID through host systemd; no second OS is silently installed.
Podman/Quadlet was evaluated but is not needed for this storage workflow.

Verification passed: all four Go race suites and vet, Linux amd64 builds,
OpenAPI generation, Svelte checks (0 errors/warnings), dependency checks
(52 passed), Regado headless UI/accessibility/reflow and production bundle
tests. Additional agent tests cover unique hardware identities, Disko PARTUUID
collisions, filesystem signatures, native geometry validation, stale approvals,
activation recovery, audit ordering and measured progress. A real loop-image
test under the production sandbox compiled and applied Disko, mounted a System
volume through host systemd and grew its neighbour with repart, preserving
System data, starts and UUIDs. The temporary loop device/image was removed.

The authorized deployment activated backend
`v0.0.2-e79441b35147-storage-20261004T151036Z-dirty`, NixOS closure
`7m61qrdh5ys2mpb0xhbhg0p3pxfv3cwp`, and frontend
`v0.0.2-e79441b35147-pages-20261004T152539Z-dirty`. Previous binaries, module,
closure and frontend targets are retained for rollback. Production service,
Keycloak iframe, HTTPS artifact and protected-socket checks passed; no failed
systemd units were reported and unauthenticated Regado API access returned 401.
The filesystem and GPT labels of the existing root were corrected to `NixOS`,
without changing its UUID, size or boot-device lookup. A real native dry run
confirmed that `/dev/sda` can allocate its 64 GiB gap to System while preserving
the existing Storage partition. This physical layout was not applied.
A fresh read-only pool check completed at 15:27:11 UTC: 6,842 regular files,
579,152,273 bytes, two-disk redundant placement, passed checksums and zero
unreadable paths. This is filesystem/profile evidence, not an independent
backup or per-file physical-extent inspection.

## Regado operational clarity — 4 October 2026

Overview graphs label local time and measurement units, explain each metric
through the shared `ContextHelp` popover, display the latest sample and disable
the empty uPlot cursor legend. `ServiceStatus` and `system-model` give Overview
and System the same named, text/color health states and service explanations.
Maintenance includes DNS schedule/outcome and timestamped storage-check results.

The agent reads native process types, results, exit codes and timer schedules.
The production ddclient oneshot was observed completing successfully with exit
code zero and an active once-per-minute timer. `inactive/dead` between those
runs is normal. The immediate-check action starts the timer and service without
interrupting an existing run; the interface labels it **Update now**.

Logs show allocated host-wide journal disk/RAM usage and offer audited retention
changes. OpenAPI owns the wire schemas and the allowed-period TypeScript type.
The agent serializes atomic private policy writes, verifies effective settings,
rolls back failed restarts and uses native journalctl rotation/vacuum. Tests
cover unknown usage, body validation, authorization/audit ordering, overridden
configuration, restart failure and cleanup failure. A cleanup failure reports
the saved policy separately from incomplete history removal.

Verification passed: generated OpenAPI types, Svelte checks with zero errors or
warnings, all four Go race suites and vet, Linux amd64 Kerno/agent builds,
52 dependency checks, production bundle checks, and headless Regado navigation,
graph help, service states, retention mutations, accessibility and 320px reflow.
The NixOS module built as closure `sm7xg9l1gkpkgvfaxv40r48dc95wxgn2` in an
isolated verification workspace. Its compiled drop-in points to the private
persistent policy. A real tmpfiles fixture initialized 14 days, preserved a
subsequent 7-day selection and retained root-owned mode 0600 on repeated runs.
Those verification fixtures did not activate production or clean its journal.

### Authorized deployment

The subsequent requested deployment activated backend release
`v0.0.2-9f5f85b2a97a-regado-20261004T171814Z-dirty`, the verified NixOS closure
`sm7xg9l1gkpkgvfaxv40r48dc95wxgn2`, and frontend
`v0.0.2-9f5f85b2a97a-pages-20261004T172337Z-dirty`. Previous binaries,
configuration, closure and static target remain available for rollback.
Kerno readiness was awaited after the identity-provider restart before the
frontend switched. Production checks passed for Kerno/Nodo health, the protected
agent socket, Keycloak discovery and SSO iframes, served static artifacts and
public HTTPS Regado. No failed systemd units were reported.

The live journal response reports 33,566,720 allocated bytes, a 256 MiB budget,
14-day retention and managed policy integration. The live ddclient response
reports a successful oneshot with exit code zero and an active waiting timer,
including native last/next timestamps. This confirms real deployed telemetry;
the earlier fixture tests cover administrator mutations and failure recovery.

## Shared Deep Purple theme — 4 October 2026

The STaSBRL design system now owns one Deep Purple palette for light and dark
mode, including Fontsource typography, shadows and semantic Tailwind tokens.
All five app root layouts mount `ThemeProvider`; headers compose the same Rhea
Button/Lucide `ThemeToggle`. `mode-watcher` handles the pre-hydration head script,
system preference, persisted choice and cross-tab synchronization. Hardcoded
green decorative shadows were replaced with the theme tokens.

Keycloak serves a generated copy of the canonical palette and a native head
script using the same preference key. Its login footer and password visibility
control now respect both modes; the footer no longer overflows a 320px viewport.
Light muted/destructive and dark primary/accent tokens were adjusted for
contrast on the existing tinted UI surfaces.

Verification passed: Svelte checks with zero errors/warnings, 37 auth checks,
52 dependency checks, nine static-build/config/asset/performance checks, five
media/chat geometry checks, and headless public, Fluo, Ligo and Regado suites.
Public checks exercise keyboard toggling, system-following behavior, explicit
override, reload, cross-app tab synchronization and dark palette application
with hydration scripts blocked. Regado accessibility checks cover every section
in both modes. A read-only live Keycloak check passed for login/registration in
light/dark mode at 1280px and 320px. It creates no account. This theme work did
not change identity policy, wire schemas or backend behavior.

## Agordoj appearance settings — 4 October 2026

The public `/agordoj/` Portal route selects shared appearance without an account
request. `AgordojLink` is the rightmost control in application headers.
`ThemePicker` composes the official Rhea Radio Group with Bits UI keyboard and
selection behavior. Preview cards consume each palette's actual scoped tokens.

The shared catalog contains Deep Purple (default), Discord, Leadgen, Lara,
Damon, Party Rock and Japan Blues. The additional supplied CSS files are scoped
and imported as semantic palettes, with duplicate Tailwind declarations removed,
the invalid Japan Blues color corrected and Fontsource family names normalized.
Mode and theme preferences remain separate, persist across app navigation and
reload, and synchronize across tabs through `mode-watcher`. Keycloak assets and
its preference script are generated from the same catalog.

Verification for this addition: `pnpm check:front` completed with zero errors
and warnings, and `pnpm build:pages` built all five applications including the
prerendered appearance page. These are compilation checks; browser interaction
tests for the new picker were not run in this change.

## Theme selection contrast — 4 October 2026

Accent icons now use their matching foreground rather than the primary fill
color. Fluo mobile navigation composes the same Rhea Button variants as desktop
navigation, including its More menu trigger. Icons and labels inherit selected
and hover colors. Lists containing secondary metadata use neutral hover surfaces;
secondary panels and dialog controls use the matching semantic foreground.

All seven palettes separate primary fills from readable link text and share a
card-based primary tint. Chat bubbles, avatars, badges and decorative surfaces
consume that tint rather than calculating unrelated colors. Imported foreground,
muted and destructive colors are adjusted where their original contrast was too
low. Primary hover effects retain the foreground/background pair. Keycloak
palette assets are generated from the same canonical sources.

Verification: `pnpm check:front` reported zero errors and warnings;
`pnpm build:pages` built all five apps. Headless Chromium color inspection covered
14 theme/mode combinations: solid semantic foreground/background pairs, link
and muted text on neutral and tinted surfaces, destructive text on 10–30% alpha
overlays, and secondary-button hover colors. The lowest measured contrast among
those pairs was 4.55:1. This palette inspection is not a complete UI accessibility
audit; browser interaction suites were not run for this change.

## Direct identity entry and appearance handoff — 4 October 2026

The login/registration route previously ran passive `check-sso` before interactive
authentication and marked its browser history entry as already started. A full
SSO fallback redirect could return to that entry and leave a second welcome
screen. Interactive entry now uses Keycloak's supported login/register URL
builders without a session probe and replaces the entry route. The history flag
and confirmation screen are removed. Only loading and recoverable error states
remain; completed work cannot navigate after the component is destroyed.

Local apps and Keycloak use different ports, so their local storage is separate.
`withIdentityAppearance` carries the actual selected theme and preferred mode
to the hosted form. Storage keys and parameter names share one configuration.
The generated native script accepts known palettes/modes, applies them before
paint, persists them on the identity origin and removes the consumed parameters
so reload cannot replay stale appearance. Registration, errors and later native
steps read the identity origin's current preference. Nonce, state, return URI
and PKCE generation remain owned by `keycloak-js`.

Verification: Svelte checks reported zero errors/warnings and all five static
apps built. A read-only headless inspection of real local entry routes used
Lara/light on Portal against older Deep Purple/dark on the identity origin.
Login and registration both opened with Lara/light and persisted it there. Each
made one interactive authorization request with S256 and the correct return
path, without a `prompt=none` request. Browser Back returned to Agordoj rather
than a second login screen. Existing static and VM checks were adjusted for the
new entry copy and browser URL dependency; those test suites were not run in
this change.

## Remembered consumer sessions — 6 October 2026

Both realm imports now declare a 30-day idle window and a five-year absolute
session limit. Authentication and token refresh renew the idle window. Access
tokens still last five minutes; refresh tokens rotate with no reuse. The native
password form defaults **Stay signed in** on, preserving a device opt-out through
validation errors. Only that preference is stored in local storage. Keycloak owns
the HttpOnly identity cookie; the app's OIDC tokens remain in memory.

The existing synchronizer repairs these values in populated realms and removes
web-client lifetime overrides while preserving unrelated attributes. Realm and
client updates are verified after writing and are idempotent. Cookie persistence
takes effect on the next password login. Production rollout requires applying
the updated realm policy and identity theme together.

Verification: all 41 `pnpm test:auth` checks passed. Targeted headless checks
against local Keycloak 26.7.4 passed for native identity themes and OTP errors,
and for password/TOTP setup, persistent-cookie restoration in a new browser
context, independent Fluo/Ligo token chains, sliding refresh expiry, replay
rejection and logout invalidation. These were three targeted live tests; the
full product integration suite was not rerun. Local policy reconciliation was
applied. Read-only inspection of production Keycloak 26.7.5 confirmed its prior
30-minute idle/10-hour maximum policy; production rollout was not performed.

## Fluo activity notifications — 6 October 2026

Fluo now records likes, dislikes, direct replies, quotes and new followers in
Kerno's PostgreSQL transaction for the originating action. Migration 014 adds
recipient-owned read timestamps, timeline/partial unread indexes and cascading
post/account cleanup, including an indexed one-hour cooldown shared by all
kinds for a recipient, actor, kind and destination post. Actual repeats append
a fresh row after the hour while retaining earlier read history; every new
reply/quote ID notifies separately.
Originating relation/post writes serialize repeats before the cooldown query;
unchanged action requests do not create new alerts. Self-actions and private
saved-post identities do not produce alerts. Private replies/quotes notify
when actually published. Existing engagement is not backfilled.

Notification pages, previews and counts apply current post/ancestor access
checks. Shared media and recursive-access expressions use Jet column references
for correlation, and feed/notification pagination shares one cursor predicate.
Each list page, its count and bulk-read boundary use one read snapshot; bulk
reads leave newer events unread. Reactions use a shared post row lock while
authorization, the mutation, notification insertion and response reading remain
in one transaction, allowing different users' reactions to proceed concurrently.

The existing focused-post/history flow opens notification destinations and
returns to Notifications. A cohesive Svelte controller owns query cancellation
and one scoped TanStack read mutation for single-item and bounded bulk reads.
Read-cache transformations and page merging live in api-client. Reading is
one-way in the API and UI.
Unread cards expose a full-height right bookmark strip with no transparent
button-border/baseline gap. It slides away on confirmed reads, with
reduced-motion and keyboard-focus handling. The bulk-read button is present
only when the recipient has unread notifications; its reserved toolbar rows
keep the list in place when it disappears. Destination media uses
shared medium previews capped at 176 pixels high; videos render a static
black frame with a Play symbol, mounting no player and fetching no video URL.
The normal Vidstack player loads in the focused post. Existing media
signatures stay stable within each minute to avoid four-second image reloads.

The latest page or lighter unread summary polls every four seconds in the
foreground, with a margin within the five-second update target, and refreshes
on focus/reconnection. Native cursor pagination reuses the recent page without
a second first-page request and joins history at the exact current boundary,
so older-page refreshes cannot delay current activity. A missing boundary
rebuilds history through native query invalidation. Older pages refresh every
five minutes to renew media links and access state. Activating either polling
query refreshes it immediately. Ordinary posting, reaction, follow and save
mutations invalidate post queries without refetching notification history;
visibility/deletion still invalidate every affected resource. Queries consume
AbortSignal and the app clears its cache on teardown. Desktop navigation and
the mobile More control/menu show unread counts. Existing browser fixtures
were adapted to the new read endpoints.

OpenAPI types and Jet table definitions were generated from their sources.
The uncommitted migrations were consolidated into 014 before publication;
its final schema preserves the already-created local notification history.
Reaction/follow write helpers keep each relation change and notification in
one transaction with guard clauses for unchanged requests. The self-follow
guard accepts UUID letter case consistently with ID validation and PostgreSQL.
The Fluo coordinator also suppresses obsolete error, dialog and scroll
callbacks after teardown.

Refactor evidence: `pnpm check:front` reported zero errors and warnings in all
six Svelte projects. `pnpm build:pages` built all five applications; the final
Fluo build also completed after the last notification layout/query edits.
OpenAPI declarations were regenerated. All four Go modules built and passed
`go vet`. Generated Jet SQL was inspected for preview/subject column correlation;
this was source inspection, with no product query executed. Modified fixture
and migration scripts passed `node --check`; `git diff --check` was clean.
No functional notification tests were added or run in this change.

## Fluo notification/privacy settings and refactor — 6 October 2026

Settings now opens separate Notifications and Privacy sections through the
existing SvelteKit shallow navigation. Rhea/Bits UI radio groups own keyboard
selection; TanStack Query owns cancellation and serialized mutations. Pending
patches from its mutation cache overlay confirmed query data, keeping selection
immediate while earlier responses arrive. Each change uses a partial
authenticated settings request, and PostgreSQL upserts only supplied columns,
preserving preferences changed in another section or session. Migration 015
stores account-owned settings with defaults and constraints; OpenAPI and Jet
declarations are generated. Validation requires each supplied preference group
to contain a change, matching the OpenAPI request constraints.

Likes, dislikes, replies, follows and quotes default to **Notify**; unfollows
default to **Off**. Every category also offers **Only people I follow**, evaluated
from the recipient's follow relation when the action occurs. Preferences govern
future notifications and preserve existing read history. A real unfollow now
records activity in its relation transaction, using the same one-hour cooldown
as other repeated actions. New reply/quote IDs still notify independently.

Account privacy is public by default. A private account grants post access to
its author and the accounts its author follows. Individual private posts remain
author-only. A shared lineage predicate applies this policy to feeds, search,
saved posts, focused threads, quoted previews, interactions and notifications;
reply/quote counts omit inaccessible posts. Administrative access remains
governed by the existing audited access-case workflow.

Likes are visible by default. Hidden likes contribute to the aggregate count
without inserting an identifying notification. Reads also hide existing like
notifications while their actor hides likes, including unread counts and read
mutations. Returning to visible likes does not backfill actions performed while
hidden. Ordinary post mutations invalidate only feed/comment/thread resources;
privacy saves invalidate affected content and notification resources.

Preference controls stay enabled during saves. A single CSS highlight follows
equal grid tracks; the chosen policy also tints its section and icon. Responsive
layout and Bits UI arrow navigation use the same breakpoint. Focus rings and
reduced-motion preferences remain supported. The shared Rhea radio indicator
stays mounted for opacity/scale transitions, and its selection styles and
`ThemePicker` now match the installed Bits UI `data-state="checked"` attribute.

The accumulated settings changes were reviewed through their related feed,
thread, interaction, media and notification paths. Maintainability changes:

- One row template renders notification and privacy preferences. A typed
  single-field mutation replaces generic nested-patch error bookkeeping;
  obsolete failures are superseded only by a newer choice for that field.
  The native mutation scope serializes saves and application teardown aborts
  requests without repopulating cleared caches.
- One view registry owns valid hashes, titles, descriptions and settings
  sections; navigation no longer casts a split URL segment into a section.
- `api-client` owns post cache removal and selective invalidation. Privacy,
  visibility and deletion refresh content/notifications without refetching
  account settings. Query Core types use a declared dependency.
- Post access uses explicit public-account/audience grants. Notification policy
  uses Jet's simple `CASE` to read the stored/default policy once, with defaults
  taken from the domain model. Existing transaction boundaries and shared
  lineage restrictions remain in place.
- Post row scanning maps absence to `ErrNotFound` consistently, including
  access revoked between a reaction's access check and its final read.

Compilation evidence: `pnpm check:front` reported zero errors and warnings in
all six Svelte projects; `pnpm build:pages` built all five static applications.
All four Go modules built and passed `go vet`. OpenAPI declarations were
regenerated; the migration runner passed `node --check`; `git diff --check`
was clean. Migration 015 was applied to the local development database during
implementation. No production release accompanied this refactor. Access and
policy predicates were reviewed from source; functional/browser tests were
not added or run for these changes.

## Fluo reaction controls and refactor — 6 October 2026

Post reactions use a red heart for Like and a larger, heavier X for Dislike.
A permanent adjacent trigger opens the existing Rhea/Bits UI menu, which owns
keyboard selection, dismissal and focus restoration. The primary button
removes an active reaction. Motion is local CSS with reduced-motion support;
selection and counts remain tied to confirmed server data.

The accumulated changes were reviewed through feed, reply, focused-post,
notification, settings, request and live-journey paths. Maintainability changes:

- One reaction description supplies both the primary glyphs and menu choices.
  CSS flex layout distributes action widths without JavaScript column counts,
  hover tracking or separate pointer-specific layouts.
- Shared controller callback types derive from the existing implementation
  and generated post schema. Reaction results reach the animation component,
  allowing a failed save to clear pending motion without shadowing counts.
- Function bindings keep reaction and both visibility radio menus tied to
  confirmed values, including after a failed request.
- `api-client` accepts cancellation signals for reactions, follows, saved
  posts and visibility changes. The application aborts its post-action scope
  before clearing query caches; obsolete callbacks do not report errors.
- Notification and settings icons match the reaction symbols. The existing
  live journey now observes the reaction response separately from the UI and
  uses native menu roles, keyboard access and Escape focus restoration.

Compilation evidence: `pnpm check:front` reported zero errors and warnings in
all six Svelte projects; `pnpm build:pages` built all five static applications.
Vite emitted its advisory for a chunk larger than 500 kB; no size budget was
changed. The updated live-journey script passed `node --check`, and
`git diff --check` was clean. No functional/browser tests or hosted CI run were
executed for this refactor. No production release accompanied these changes.

## Fluo composer layout and refactor — 6 October 2026

The composer starts with a 12rem draft region and grows with text, replies,
quotes and attachments up to the dialog's 44rem/90dvh cap. The draft viewport
then scrolls independently while the publishing controls remain visible.
Native Svelte dimension bindings measure intrinsic content and the responsive
options panel; the preferred height reserves the panel in both states. Closed
options remain measurable, invisible and inert. Opening them preserves the
dialog height and the last visible text line without premature overflow for
short drafts. The editor keeps a neutral border when focused.

Formatting composes the shared Rhea Toggle Group and Tiptap mark commands;
Public/Only me uses the existing Dropdown Menu radio items. Bits UI owns keyboard
selection, dismissal, focus and dialog presence. The formatting subscription
follows editor transactions and is removed on teardown. Shared toggle variants
have one owner, and Svelte's typed `createContext` replaces string keys,
context assertions and unused orientation state.

The review covered all accumulated composer changes, editor/publishing/media
helpers, shared primitives and existing fixture/live journey selectors.
Refactoring removes the duplicate close-animation timer and flags, retains only
the reply/quote context for native dialog presence, and consolidates the
character limit and options focus/scroll handling. Obsolete scroll callbacks
cannot update a detached viewport or a superseded panel state. Editor CSS is
scoped locally; the existing editor configuration already owns its focus
outline. No wire schema, upload workflow or production deployment is changed.

Compilation evidence: `pnpm check:front` reported zero errors and warnings in
all six Svelte projects; `pnpm build:pages` built all five static applications.
The updated live-journey script passed `node --check`, and `git diff --check`
was clean. No functional/browser tests or hosted CI run were executed for this
refactor. Vite retained the existing Rondo advisory for a chunk larger than
500 kB; no size budget was changed.

## Remaining boundaries

- No content E2EE, user-held decryption keys or system escrow lifecycle; Regado cases authorize existing plaintext data and notify/audit access.
- Data1 RAID1 mirrors two physical disks, but an independently recoverable backup destination/key copy/schedule still require configuration. Local development does not mirror disks.
- Public voice quality depends on reachable signaling/RTC/TURN, actual devices and external networks. Synthetic local camera/room tests do not establish that quality.
- Chromium/axe/reflow tests do not cover every browser, screen reader or native macOS trackpad rubber-band interaction. No participant UEQ/VisAWI study or production load test was performed.
- Notifications outside Fluo, other account settings, ownership transfer/moderation, Matrix and Cloudflare integrations remain outside implemented workflows. Reserved crypto is intentionally empty.
