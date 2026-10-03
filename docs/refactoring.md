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

- No content E2EE, user-held decryption keys or system escrow lifecycle; Regado cases authorize existing plaintext data and notify/audit access.
- Data1 RAID1 mirrors two physical disks, but an independently recoverable backup destination/key copy/schedule still require configuration. Local development does not mirror disks.
- Public voice quality depends on reachable signaling/RTC/TURN, actual devices and external networks. Synthetic local camera/room tests do not establish that quality.
- Chromium/axe/reflow tests do not cover every browser, screen reader or native macOS trackpad rubber-band interaction. No participant UEQ/VisAWI study or production load test was performed.
- Notifications, full settings, ownership transfer/moderation, Matrix and Cloudflare integrations remain outside implemented workflows. Reserved crypto is intentionally empty.
