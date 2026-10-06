# Refactor review — 3 October 2026

## Scope and outcome

Reviewed the accumulated, uncommitted maintainability refactor across all five apps, shared packages, four Go modules and repository scripts. The refactor preserves wire schemas and existing product workflows. Generated OpenAPI/Jet files, credentials, user content and build output are not refactor targets. No production deployment accompanies this change.

This is an engineering review with automated evidence, not a new ISO score or a claim that every possible device, browser and failure mode is bug free. Historical audit scores retain their dated scope.

## Ownership after refactoring

| Layer | Responsibility |
| --- | --- |
| Portal | Welcome/app entry/auth presentation; shared account controller handles the session |
| Fluo | Controller for selection/navigation/mutations; separate feed/header, composer/editor/publishing, post actions/replies/detail |
| Ligo | Conversation selection and SSE/query coordination; separate sidebar and conversation dialog |
| Rondo | Server/channel coordination, member panel, layout helpers and voice views; shared chat pipeline |
| Regado | Independent query resources and mutations; overview/storage/system/users/audit/log panels and action/access dialogs |
| auth / account-ui | In-memory OIDC tokens; verified account bootstrap and nonauthorizing per-tab preview |
| api-client / contracts | Typed requests, response/refresh policy, query keys, pagination, cancellation and immutable message-cache helpers; generated wire schemas |
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

## Remaining boundaries

- No content E2EE, user-held decryption keys or system escrow lifecycle; Regado cases authorize existing plaintext data and notify/audit access.
- Data1 RAID1 mirrors two physical disks, but an independently recoverable backup destination/key copy/schedule still require configuration. Local development does not mirror disks.
- Public voice quality depends on reachable signaling/RTC/TURN, actual devices and external networks. Synthetic local camera/room tests do not establish that quality.
- Chromium/axe/reflow tests do not cover every browser, screen reader or native macOS trackpad rubber-band interaction. No participant UEQ/VisAWI study or production load test was performed.
- Notifications, full settings, ownership transfer/moderation, Matrix and Cloudflare integrations remain outside implemented workflows. Reserved crypto is intentionally empty.
