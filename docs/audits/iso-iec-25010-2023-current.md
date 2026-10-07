# Kaordo implemented-scope audit — ISO/IEC 25010:2023

> Historical assessment of the tree and scope at the stated date. Scores, paths and deployment gaps describe that assessment, not the current refactored tree. See the [7 October 2026 quality audit](iso-iec-25010-2023-2026-10-07.md), [refactor review](../refactoring.md) and [current architecture](../architecture.md) for updated ownership, capabilities and verification.

**Date:** 2026-10-01. **Quality Score: 89.0/100. Lowest characteristic: Security, 81.2/100.** The requested ≥99 overall, ≥95 in every characteristic and no Critical/High findings is **not met**. No Critical code defect or known published dependency vulnerability was confirmed. The absence of an independent, recoverable copy of local account and media data remains a **High operational release blocker**.

## Scope and scoring method

This audit assesses the functionality that exists now: local Keycloak registration/sign-in/TOTP/recovery, the account projection in Kerno, Fluo, Ligo, Nodo, shared frontend packages, local launcher and static Pages artifact. Rondo, Regado, notifications, full Settings, Matrix, LiveKit and public Cloudflare ingress are future or placeholder scope. Their absence is disclosed but is not scored as a defect in the implemented slice. The [ISO/IEC 25010:2023 product-quality model](https://www.iso.org/standard/78176.html) defines nine characteristics; the 0–100 values and equal weighting below are this audit's engineering rubric, **not ISO certification or an ISO-prescribed Quality Score**.

Each of the 40 subcharacteristics receives a score from observed checks, source inspection and explicit evidence gaps. Characteristic scores are arithmetic means of their subcharacteristics, rounded to one decimal; the Quality Score is the unweighted mean of the nine unrounded characteristic means, rounded to one decimal. Rubric: 0–49 absent or unverified; 50–69 partial controls; 70–84 working local evidence with material gaps; 85–94 representative integrated normal and failure checks; 95–100 repeated, production-like security, recovery, scale, accessibility and operating evidence. A green test establishes only the paths and conditions it exercises.

| Characteristic | Score |
| --- | ---: |
| Functional suitability | 92.7 |
| Performance efficiency | 90.0 |
| Compatibility | 92.5 |
| Interaction capability | 89.8 |
| Reliability | 83.5 |
| Security | 81.2 |
| Maintainability | 92.4 |
| Flexibility | 89.8 |
| Safety | 89.0 |
| **Quality Score** | **89.0** |

## Reproducible evidence

| ID | Check or source | Observed result and boundary |
| --- | --- | --- |
| E1 | `pnpm check:front` | Six Svelte workspaces report zero errors and warnings. This proves neither runtime correctness nor browser compatibility. |
| E2 | `pnpm test:auth`, `test:dependencies`, `test:dev`, `test:ui-layout`, `test:backup` | All **31 + 45 + 4 + 5 + 4** unit and structural checks pass with no skips. They cover auth/session, API client, direct package imports, launcher port ownership, media/chat layout and backup configuration. |
| E3 | `pnpm test:product:db` | A disposable PostgreSQL 18 database receives migrations 001–009. Fluo/Ligo authorization, post and message flow, media reuse/deletion, group capacity and migration replay pass; PostgreSQL package statement coverage is **72.4%**. A 20,000-post/100-author/40-read fixture produced Fluo Latest p95 **0.933 ms** and selective search p95 **5.077 ms**. A 10,000-message/40-read fixture produced Ligo latest-page p95 **1.220 ms** and conversation-with-unread-count p95 **1.064 ms**. These are local query-path timings, not end-to-end latency or a sustained-load guarantee. |
| E4 | `go test -race ./services/kerno/... ./services/nodo/... ./services/mediaauth/...`; `go vet`; `go build` | All pass. Command packages have no direct unit tests. PostgreSQL integration has its own E3 database gate. |
| E5 | `pnpm test:pages`; `pnpm test:ui-public` | All five app entry routes are built; artifact references and lazy-loading assertions pass, including Fluo's <100 KiB gzip initial-JS budget. Headless Chromium checks public routes at 320/768/1280 CSS pixels and dark 320px: no horizontal overflow or automated WCAG 2.2 A/AA axe findings. Automated axe does not replace assistive-technology or user testing. |
| E6 | `pnpm test:auth:live` against `pnpm dev` | One headless journey passes registration, TOTP setup/login, recovery code, account/SSO, four-image and video posting, media dimensions, carousel controls, replies/quotes, saved posts, Ligo messaging/reactions/media and chat scroll/resize/history behavior. Thirty-two concurrent local account lookups measured p95 **16 ms**. This was one local Chromium run, not cross-browser or remote-load evidence. |
| E7 | `pnpm test:backup:live`; `diskutil list external physical`; restic environment check | Encrypted restic backup and disposable restore of both databases plus media pass. No external physical disk or configured independent restic repository was found. The test's temporary repository proves the procedure, not survival of a primary-disk failure. |
| E8 | `pnpm audit --audit-level=low`; `govulncheck@v1.8.0 ./...` in Kerno, Nodo and mediaauth | No **known published** npm or called Go vulnerability reported at audit time. This cannot prove that code or dependencies are vulnerability-free. |
| E9 | `pnpm --filter @kaordo/contracts generate` with diff check; `.github/workflows/checks.yml` | Generated OpenAPI types match the contract. CI now requests type, build, race, database, public Chromium, live product and restore checks; no successful hosted CI run was observed for this revision. |
| E10 | Package manifests, source imports and `pnpm licenses list --json` | Direct-import declarations pass. Package metadata reports 203 MIT packages and other open-source licenses. One transitive `combine-errors@3.0.3` entry has Unknown metadata, while its packaged README states MIT. The repository has no root `LICENSE`, so Kaordo's own redistribution permission is unspecified. |
| E11 | Kerno/Nodo source and database migrations | Kerno checks OIDC subjects, membership and ownership; PostgreSQL serializes media claim retirement with reuse, and Ligo sends with member additions; Nodo implements tus uploads, processing bounds and a 23-hour acceptance/24-hour garbage-collection gap. Rate limits and request/media size limits exist. These are code and targeted-test observations, not a penetration test. |
| E12 | This change set | Group membership capacity now counts only **new** members; a 25-member idempotence and overflow regression passes without changing the conversation timestamp on a retry (E3). Browser checks no longer silently skip without macOS Chrome; Linux CI installs Chromium and requests public/live checks. A 10,000-message read fixture and current Ligo documentation replace stale Fluo-only evidence. |

No manual website exploration was performed. The browser activity above came from automated Playwright tests. No production deployment, off-host restore, failover, alerting, long soak, independent penetration test, real-user study or multi-browser/device matrix was observed.

## Scores by characteristic and subcharacteristic

### Functional suitability — 92.7

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Functional completeness | 93 | Account/TOTP/recovery, Fluo feed/post/reply/quote/react/follow/search/save/media and Ligo direct/group/self chats, attachments, reactions, edits/deletes and receipts have integrated checks (E3, E6). Only the implemented slice is scored. |
| Functional correctness | 94 | Authorization, claims, cursor pages, replay, eight Ligo attachments, group capacity, media lifecycle and browser journeys pass (E2–E6, E11–E12); unexercised failures remain possible. |
| Functional appropriateness | 91 | Latest/Following, Search, Saved, Profile and Ligo saved messages support current small-network use (E6); task-success and relevance studies are absent. |

### Performance efficiency — 90.0

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Time behaviour | 92 | Measured Fluo and Ligo local p95 query paths, 16 ms local account p95 and a bounded Fluo initial JS graph (E3, E5–E6). No remote RTT, cold LCP/INP or upload p95. |
| Resource utilization | 90 | Lazy editor/media imports, indexed cursor reads, sequential client image preparation and bounded upload/transcode work (E5, E11); no sustained CPU/RAM/disk profile. |
| Capacity | 88 | 20,000 posts and 10,000 messages have measured read paths (E3). Concurrent uploads, many chats/users, long-lived browser sessions and horizontal scale remain unmeasured. |

### Compatibility — 92.5

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Co-existence | 93 | Independently built apps, Keycloak, Kerno, Nodo and two PostgreSQL instances work on one local origin (E5–E7). Other host operating systems are untested. |
| Interoperability | 92 | OIDC, OpenAPI/openapi-fetch, PostgreSQL, tusd and SSE integrate through explicit boundaries (E3, E6, E9–E11). External ingress and future Matrix/LiveKit integrations are outside scope. |

### Interaction capability — 89.8

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Appropriateness recognizability | 92 | Auth, feed and chat controls are labeled and exercised (E5–E6); no comprehension study. |
| Learnability | 89 | First-run registration, TOTP, posting and messaging work in the scripted journey (E6); no first-time-user evaluation. |
| Operability | 92 | Keyboard, dialogs, carousel, navigation, Ligo scroll/history anchoring and responsive widths have tests (E5–E6); trackpad and assistive-device breadth remains limited. |
| User error protection | 91 | Ownership, validation, quotas, limits, confirmations and retry paths are tested (E2–E4, E6, E11); adversarial UX coverage is incomplete. |
| User engagement | 89 | Feed and messaging loops are functional (E6); UEQ-style participant measurements are absent. |
| Inclusivity | 89 | Automated axe A/AA and 320px reflow pass for visited states (E5–E6); manual screen-reader/contrast reviews are missing. |
| User assistance | 85 | Auth and upload error feedback exists; in-app help and recovery guidance remain limited (E6, source). |
| Self-descriptiveness | 91 | Labeled actions, progress and error states are present in the exercised paths (E2, E6); comprehension is not measured. |

### Reliability — 83.5

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Faultlessness | 93 | Type, race, database, browser, backup and dependency checks pass (E1–E8). One local run does not estimate field failure rate. |
| Availability | 72 | Loopback health probes and a local launcher exist (E2, E6); no deployed SLO, monitoring, redundancy or failover evidence. |
| Fault tolerance | 87 | OIDC retry, resumable uploads, idempotent message send, bounded media work and guarded cleanup exist (E2–E4, E11–E12). Disk and network partitions are untested. |
| Recoverability | 82 | Disposable encrypted restore passes (E7), but no independent destination, separately retained key, schedule or real off-host drill exists. |

### Security — 81.2

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Confidentiality | 88 | OIDC, private-post queries, chat membership, signed media URLs and owner checks are tested (E3–E6, E11). Media and private content lack product-level encryption at rest/end to end. |
| Integrity | 93 | Parameterized SQL, token verification, constraints, claim transactions, media dimensions and restore checks pass (E3–E4, E7, E11–E12). Cross-service consistency under failure is unproved. |
| Non-repudiation | 55 | Persistent actor IDs exist, but there is no tamper-evident action trail or signed evidence for disputed actions. |
| Accountability | 68 | Keycloak subjects map to UUIDv7 accounts; ordinary logs are not a retained, access-controlled administrator audit trail. |
| Authenticity | 94 | PKCE/OIDC issuer/audience/subject, TOTP/recovery and service signatures pass tests (E2, E4, E6). No deployed federation/device-lifecycle assessment. |
| Resistance | 89 | Advisory scans are clean; origin, token, payload, rate, quota and upload bounds exist (E2–E4, E8, E11). No external abuse or public DoS test. |

### Maintainability — 92.4

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Modularity | 93 | Separate SvelteKit apps, shared packages and Go modules have distinct owners (E1, E9–E11). |
| Reusability | 93 | Shared UI/auth/API/contracts/media packages and imported editor, upload, carousel and player libraries avoid duplicate engines (E10–E11). |
| Analysability | 93 | Contracts, migrations, coverage, source tests, CI and this evidence ledger support diagnosis (E1–E12); deployed tracing is absent. |
| Modifiability | 92 | The capacity fix has a focused DB regression; direct-import and contract checks constrain drift (E2–E3, E9–E12). |
| Testability | 91 | Disposable DB, headless browser, race and restore tests exist, including a CI request for live checks (E3–E9). No hosted run was observed, and command packages lack direct unit coverage. |

### Flexibility — 89.8

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Adaptability | 93 | Independent apps and OIDC/OpenAPI/tus/SSE boundaries support evolution (E1, E9–E11); alternative topologies are untested. |
| Scalability | 88 | Cursor/indexed reads and 20,000-post/10,000-message fixtures pass (E3); no high-concurrency or horizontal-scale result. |
| Installability | 90 | `pnpm dev`, Compose, migrations and static assembly work locally (E3, E5–E7); no clean production-host rehearsal. |
| Replaceability | 88 | Standards-based interfaces reduce provider lock-in (E9–E11), but replacement of Keycloak, PostgreSQL or media storage has not been demonstrated. |

### Safety — 89.0

For this non-safety-critical local product, account exposure and data loss are the relevant harms.

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Operational constraint | 89 | Local service binds, request/upload limits, media bounds and quotas constrain unsafe operation (E4, E11); no public ingress policy is deployed. |
| Risk identification | 89 | Media races, quotas, search cost, group capacity and backup independence were reviewed and tested (E3, E7, E11–E12); no operational risk telemetry. |
| Fail safe | 92 | Invalid tokens/ownership, retired claims and unavailable account/media states fail closed in targeted tests (E2–E4, E11). |
| Hazard warning | 86 | Upload/auth/destructive-action feedback exists (E6); no scheduled-backup or data-loss alerting. |
| Safe integration | 89 | Local Keycloak/Kerno/Nodo/DB and disposable restore integrate (E3, E6–E7); external ingress and off-host recovery are unverified. |

## Third-party library and duplication review

| Function | Actual implementation and finding |
| --- | --- |
| STaSBLR | SvelteKit and Tailwind are used across apps; `packages/ui/components.json` selects shadcn-svelte's Rhea preset. The UI source imports Bits UI behavior and Lucide icons. Rhea is a style preset, not a separate runtime dependency. Local style overrides are intentional; upstream pixel parity is not claimed. |
| Identity | Keycloak handles password, TOTP and recovery; `keycloak-js`/OIDC handles browser auth. Kerno maps verified subjects to accounts. No custom password or OTP implementation was found in the product services. |
| Data and API | Go `chi` routes APIs, `pgx` handles PostgreSQL, generated OpenAPI declarations feed `openapi-fetch`, and `@microsoft/fetch-event-source` consumes Ligo SSE. Custom code is limited to Kaordo authorization and domain behavior. |
| Fluo | TanStack Query/Virtual, Tiptap, Embla, PhotoSwipe and Vidstack are actually imported for caching/virtualization, editing, galleries and media playback. Tiptap/media/player code loads lazily. Kerno has a deliberately limited validator for the stored Tiptap JSON; there is no duplicate editor, carousel engine or video decoder. |
| Ligo | TanStack Query, shadcn-svelte/Bits UI context menus and shared media UI are used. Message delivery uses Kerno SSE plus PostgreSQL notifications; Socket.IO and Matrix Rust SDK are **not** imported or claimed. Native chat scrolling is a deliberate response to prior virtual-scroll jumps; very long loaded histories still need browser-memory evaluation. |
| Upload/storage | Uppy/Tus and tusd implement resumable transfer, Pica image resizing, and FFmpeg/ffprobe media processing. Nodo owns bytes, limits, metadata and cleanup; no duplicate upload protocol was implemented. |
| Dependency/legal hygiene | Import ownership tests pass and npm/Go advisory scans find no known issue (E2, E8). The transitive `combine-errors` metadata anomaly and missing Kaordo root license require resolution before claiming unrestricted redistribution (E10). |

## Findings and changes

| Severity | Finding | Current state |
| --- | --- | --- |
| **High operational** | The tested restic restore uses a disposable/local repository. The primary-disk failure case has no independent data copy and separately retained key (E7). | **Open.** This prevents the requested no-High and ≥99 result for real user data. |
| Medium | The public Chromium accessibility/reflow test silently skipped on Linux because it required a macOS Chrome path. | **Fixed:** installed Playwright Chromium is the fallback, and CI now runs this check instead of accepting a skip (E5, E12). Hosted CI has not yet been observed. |
| Medium | Live account/product/recovery paths were available only as manual local checks. | **Fixed in workflow:** CI now requests the full local stack, headless auth/product journey and encrypted restore (E6–E9). A hosted run remains to be observed. |
| Low | Re-adding an existing Ligo member at the 25-person limit incorrectly returned a capacity error and changed the chat timestamp. | **Fixed:** count only new requested members, skip the unnecessary update, and cover idempotence and genuine overflow (E3, E12). |
| Evidence gap | Ligo was described as a scaffold and had no long-history read measurement. | **Fixed:** README and this audit describe the implemented chat; a 10,000-message fixture measures real read paths (E3, E12). Browser memory and concurrent-load evidence are still missing. |
| Medium | There is no tamper-evident administrative action trail, active-site availability evidence or independent recovery destination. | **Open.** These are the strongest limits on Security and Reliability scores. |

The implemented code has strong local functional checks and no confirmed Critical code defect. The evidence above supports **89.0/100**, not 99/100; Security **81.2**, Reliability **83.5** and the open **High** recovery gap make the requested threshold indefensible today.
