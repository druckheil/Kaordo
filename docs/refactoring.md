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
| ui / chat-ui | STaSBLR primitives and shared message/composer/native-scroll interaction |
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

## Remaining boundaries

- No content E2EE, user-held decryption keys or system escrow lifecycle; Regado cases authorize existing plaintext data and notify/audit access.
- Data1 RAID1 mirrors two physical disks, but an independently recoverable backup destination/key copy/schedule still require configuration. Local development does not mirror disks.
- Public voice quality depends on reachable signaling/RTC/TURN, actual devices and external networks. Synthetic local camera/room tests do not establish that quality.
- Chromium/axe/reflow tests do not cover every browser, screen reader or native macOS trackpad rubber-band interaction. No participant UEQ/VisAWI study or production load test was performed.
- Notifications, full settings, ownership transfer/moderation, Matrix and Cloudflare integrations remain outside implemented workflows. Reserved crypto is intentionally empty.
