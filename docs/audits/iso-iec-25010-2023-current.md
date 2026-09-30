# Kaordo quality audit — ISO/IEC 25010:2023

**Audit date:** 2026-09-30

**Scope:** current `scope-0.0.1` repository and working tree: account/identity, Fluo, Kerno, Nodo, shared packages, static Pages output, local development and backup tooling. Ligo, Rondo and Regado are included in the intended suite assessment even where their workflows are still placeholders.

**Result:** **78.4/100** overall. Lowest characteristic: **67.3/100**. **The requested ≥99 score, ≥95 per characteristic and no Critical/High release blockers are not met.**

**Security scan result:** no known npm or Go vulnerability was reported by the checks listed below. This is not proof that the product has no vulnerabilities.

**Method:** evidence-based engineering assessment, not an ISO certification or a score defined by ISO.

[ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) defines a product-quality model with nine characteristics and associated subcharacteristics. ISO does not prescribe this report's scoring scale. Scores below use this rubric: 0–20 absent; 21–45 mostly planned or static; 46–70 a narrow working slice with focused checks; 71–94 representative integrated verification; 95–100 production-like acceptance evidence across normal, failure, security, performance and accessibility cases. Subcharacteristics within one characteristic and all nine characteristics are equally weighted. The overall result is the arithmetic mean of the nine characteristic means, rounded to one decimal. The score reflects the current product scope as well as code quality; it is not a statistical measurement.

No manual website inspection was performed. Evidence comes from repository/configuration review, builds, dependency checks, unit and integration tests, headless browser checks, and disposable database/backup exercises. Public Tunnel ingress, production deployment, representative population-scale load, an independent backup destination/key copy, restore into active databases and assistive-device testing were not performed.

## Characteristic scores

| Characteristic | Score | Lowest subcharacteristic |
| --- | ---: | --- |
| Functional suitability | **74.0** | Completeness 58 |
| Performance efficiency | **67.3** | Capacity 42 |
| Compatibility | **88.0** | Interoperability 88 |
| Interaction capability | **84.6** | User assistance 78 |
| Reliability | **73.3** | Availability 36 |
| Security | **69.5** | Non-repudiation 18 |
| Maintainability | **90.0** | Analysability 88 |
| Flexibility | **75.3** | Scalability 48 |
| Safety | **83.4** | Operational constraint 76 |
| **Quality Score** | **78.4** | **Gate not met** |

## Evidence ledger

| ID | Evidence from this audit | What it establishes and its limits |
| --- | --- | --- |
| E1 | `pnpm check:front` | All **6** frontend projects type-check with zero errors and zero warnings. This does not prove run-time behavior. |
| E2 | `pnpm test:auth` | **31/31** unit tests pass for account/session state, API retry, configuration, cancellation, stale responses and recovery behavior. |
| E3 | `pnpm test:auth:live` | **1/1** headless local journey passes: registration, TOTP and recovery login, OIDC/account bootstrap, app SSO, Fluo post with media, saved list, profile, text search, reactions, replies, quotes, access control and deletion. Automated axe checks found zero A/AA violations in the tested states; keyboard coverage is narrow. A local run of 32 concurrent Kerno lookups measured **16 ms p95**. This is not a capacity or internet-latency result. |
| E4 | `pnpm test:pages` | **5/5** artifact checks pass after building all Pages routes. Fluo's initial JavaScript dependency graph is **79,633 bytes gzip** against a 100 KiB budget; the page entry is 56.8 KiB gzip. Tiptap, the media client, PhotoSwipe and Video.js are dynamic imports. The Video.js chunk is about 703 KB raw and is loaded only for video playback. |
| E5 | `pnpm test:fluo:db` | `TestFluoPostFlow` passes against a randomly named disposable PostgreSQL database after applying migrations 001–004; the flow reports **71.3% statement coverage** for the PostgreSQL package. The test drops its temporary database. |
| E6 | `pnpm test:backup`, `pnpm test:backup:live` | Unit checks **4/4** and live encrypted restic/PostgreSQL/Keycloak backup-and-restore check **1/1** pass, restoring into disposable copies. No independent repository, separately stored key copy, recurring schedule or active-database recovery drill is configured. |
| E7 | `pnpm test:dependencies` | **26/26** checks pass across 13 workspace packages. Direct runtime dependency declarations are checked against source imports in the owning package, and imported Kaordo workspace packages must be declared directly. This is not a license or transitive dependency audit. |
| E8 | `go test -race ./services/kerno/... ./services/nodo/... ./services/mediaauth/...`, `go vet ...`, `go build ...` | Tests with the race detector, static vet and builds all pass for the three Go modules. The Fluo PostgreSQL package also passes the isolated DB test in E5. |
| E9 | `pnpm audit --audit-level=low`; `govulncheck@v1.8.0` in each Go module | No known npm advisories and no known Go vulnerabilities were reported at audit time. These tools check published advisories, not all vulnerabilities or application threat paths. |
| E10 | `pnpm --filter @kaordo/contracts generate` followed by `git diff --exit-code -- packages/contracts/src/openapi.d.ts` | Generated TypeScript API declarations match the OpenAPI source. This checks schema generation, not all API compatibility behavior. |
| E11 | `pnpm test:backup:live`, local Compose configuration, `scripts/dev-local.mjs` | Local identity/database and backup flows can run on a developer machine. The Compose stack does not deploy the whole production topology or configure Cloudflare Tunnel, monitoring, production TLS or service failover. |
| E12 | `.github/workflows/checks.yml` | Workflow now requests race-enabled Go tests, Go vulnerability scans and an npm audit that rejects Low or higher advisories. The edited workflow was not observed running on hosted CI; local commands above were run separately. `actionlint` was unavailable. |
| E13 | `pnpm licenses list --json`, package metadata and included README | Most npm packages report permissive or open-source licenses. `combine-errors` lacks a license field in npm metadata, while its packaged README says MIT. There is no root `LICENSE`; repository licensing remains undecided. |
| E14 | `AGENTS.md`, `docs/architecture.md`, app and service sources | Separate SvelteKit apps/packages and Go modules exist. Login, Fluo social posting and media processing are implemented. Messaging, calling and administrator product workflows remain incomplete; Synapse and LiveKit are not deployed by local Compose. |
| E15 | `packages/ui`, `packages/api-client`, `packages/auth`, `packages/contracts`, `packages/media-client`, `services/kerno`, `services/nodo` | Dependency ownership follows app/package boundaries: shared STaSBLR UI, typed API/OpenAPI contracts, OIDC account handling, Fluo query/media clients, Kerno HTTP/PostgreSQL and Nodo tusd/image/video processing. See “Library use” below. |

## Characteristics and subcharacteristics

### Functional suitability — 74.0

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Functional completeness | 58 | Registration, TOTP, account bootstrap, Fluo publishing/social actions, search, saved posts and media upload work. Ligo messaging, Rondo/LiveKit calling, notifications, Settings workflows and Regado administration are absent or placeholders (E3, E14). |
| Functional correctness | 84 | Auth and Fluo headless flows, migrations, API generation, Go race tests and focused media/database checks pass. Unimplemented product areas cannot be verified (E1–E5, E8, E10). |
| Functional appropriateness | 80 | Reverse-chronological Latest and Following feeds work without training data; search, saved posts and a profile view match implemented tasks. Notifications and settings currently lack complete tasks (E3, E14). |

### Performance efficiency — 67.3

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Time behaviour | 82 | Initial Fluo JavaScript is 79.6 KB gzip and editor/media code is split out. The local account endpoint returned 32 concurrent lookups at 16 ms p95. No public-network, cold-start, feed-scale or RTC latency target was measured (E3–E4). |
| Resource utilization | 78 | Lazy imports reduce initial browser work; media processing has upload limits and resource-specific code paths. No sustained CPU, memory, bandwidth, database or disk profile was taken (E4, E14–E15). |
| Capacity | 42 | The test covers 32 concurrent identity lookups and a small disposable Fluo database only. There is no representative feed size, upload volume, multi-user workload or storage-capacity result (E3, E5). |

### Compatibility — 88.0

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Co-existence | 88 | Apps build as separate SvelteKit packages and are assembled into Pages; the workspace and local services have separate ownership and run targets. Multiple OS/browser versions and production service coexistence were not exercised (E1, E4, E11). |
| Interoperability | 88 | OIDC/Keycloak, PostgreSQL, OpenAPI-generated TypeScript clients, Kerno and Nodo are used in local integration. Matrix, LiveKit and public Cloudflare Tunnel interoperability remain unverified (E3, E5, E10–E11, E14). |

### Interaction capability — 84.6

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Appropriateness recognizability | 86 | Auth and Fluo label their navigation and actions; loading, retry and account-service errors are exercised. Several destinations still lead to placeholder workflows (E3, E14). |
| Learnability | 84 | Registration, TOTP enrollment/recovery and the Fluo posting journey are covered end to end. No broader product onboarding or moderated user study exists (E3). |
| Operability | 87 | Feed/search/saved/profile navigation, post actions and account controls are exercised headlessly. Notifications and Settings are not fully operable product areas (E3). |
| User error protection | 86 | Input validation, one-time recovery-code behavior, authorization boundaries, upload ownership and failed service states have tests. No broad adversarial usability study exists (E2–E3, E5, E14). |
| User engagement | 80 | Fluo supports creating, viewing, searching, saving and discussing posts with media. No engagement or retention evidence exists, and other app workflows remain absent (E3, E14). |
| Inclusivity | 87 | Automated axe A/AA scans report zero violations in the tested login and Fluo states. This is not a full keyboard, screen-reader, contrast or assistive-device assessment (E3). |
| User assistance | 78 | English setup, login, recovery and service-error feedback exist. Help paths for unfinished services and operational support are absent (E3, E11, E14). |
| Self-descriptiveness | 89 | Current auth and Fluo states expose labeled controls and actionable errors; placeholder routes do not explain complete domain tasks (E3–E4, E14). |

### Reliability — 73.3

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Faultlessness | 91 | Frontend checks, contract generation, 31 auth tests, 26 dependency checks, five artifact checks, auth/Fluo live coverage, DB integration and Go race/vet/build all pass (E1–E10). |
| Availability | 36 | Local development services have health checks and a dev launcher. There is no production uptime target, monitoring, alerting, redundant service or failover test (E11–E12). |
| Fault tolerance | 84 | Session cancellation/retry, service failures, upload quotas, upload cleanup and backup error cases have focused handling and tests. Production node, disk, network partition and service restart behavior is unverified (E2–E3, E6, E8, E14). |
| Recoverability | 82 | Encrypted backup restores into disposable PostgreSQL/Keycloak copies; TOTP recovery works. No separately stored recovery key, independent backup target, recurring schedule or timed active-system recovery drill exists (E3, E6). |

### Security — 69.5

No Critical or High **known dependency advisory** was reported by the npm and Go scanners. Application security still lacks production ingress, private-content encryption, audit evidence for sensitive actions and a full threat-model penetration test.

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Confidentiality | 84 | OIDC bearer verification, private saved-post queries, media ownership checks and an encrypted backup exercise are present. Private-content encryption and a production TLS/ingress configuration are not implemented (E3, E6, E11, E14). |
| Integrity | 88 | Signature/issuer/audience checks, parameterized PostgreSQL access, schema constraints, generated API contracts, media ownership validation and restore checks are tested. There is no full cross-service reconciliation audit (E3, E5, E8, E10). |
| Non-repudiation | 18 | No signed receipts, append-only audit evidence or immutable event history for user/admin actions is implemented (E14). |
| Accountability | 55 | OIDC identity is mapped to a stable local user, and integration actions are traceable in tests. Product admin audit trails, retained security events and production log controls are absent (E3, E11, E14). |
| Authenticity | 90 | PKCE/OIDC login, TOTP and recovery login, JWT/JWKS checks, issuer/audience validation and media owner verification pass local integration tests (E3, E8, E14). Production federation and device lifecycle have not been tested. |
| Resistance | 82 | Known npm/Go dependency checks are clean; authentication, CORS/origin controls, upload size/owner quotas and malformed upload/media paths have tests. No external penetration, public abuse/rate-limit or representative denial-of-service test was run (E3, E8–E9, E14). |

### Maintainability — 90.0

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Modularity | 91 | SvelteKit apps, shared packages and independent Go modules have explicit ownership and independent build/check commands. Some app areas are placeholders (E1, E14–E15). |
| Reusability | 90 | STaSBLR UI, account/session code, typed API clients, contracts and media clients are shared by packages rather than copied into every app (E7, E15). |
| Analysability | 88 | Architecture docs, tests, generated contracts, race/vet checks and dependency scans support diagnosis. Hosted CI and deployed telemetry were not observed (E8–E12). |
| Modifiability | 90 | Shared boundaries, direct-dependency checks, generated schemas and lazy feature imports limit coupling. Integration coverage still concentrates on auth and Fluo (E3–E7, E15). |
| Testability | 91 | Local disposable DBs, headless browser flows, injectable interfaces, backup restore copies, Go race tests and artifact checks enable repeatable tests. Test data diversity and production-scale fixtures are limited (E3–E8). |

### Flexibility — 75.3

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Adaptability | 86 | Independent frontend packages, service modules and contracts support local evolution. Only the current local account/Fluo topology is integrated (E1, E11, E15). |
| Scalability | 48 | A small concurrency check passes; no feed index/load model, multi-node service design, RTC capacity or storage growth test demonstrates scale (E3, E5, E14). |
| Installability | 85 | Workspace commands, local Compose, Pages artifact build and local backup/restore run on the development host. There is no clean production host installation/deployment rehearsal (E4, E6, E11). |
| Replaceability | 82 | OpenAPI, OIDC and service/package boundaries allow provider changes. No migration between identity, database, object-store or backup providers has been tested (E10–E11, E15). |

### Safety — 83.4

This is a consumer product rather than a safety-critical system. Scores still account for account exposure, content loss and unsafe service exposure risks.

| Subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| Operational constraint | 76 | Local database/identity listeners bind to loopback; Kerno/Nodo enforce auth and upload limits. Public ingress and production access policy are not configured (E11, E14). |
| Risk identification | 88 | This audit records unfinished modules, missing ingress, backup-key separation, encryption and scale evidence. There is no maintained operational hazard register or release owner (E6, E11, E14). |
| Fail safe | 86 | Invalid identity, inaccessible account state, unauthorized media and invalid post data fail closed in tested paths. Production proxy/service loss and partial restore behavior remain untested (E2–E3, E5, E8). |
| Hazard warning | 83 | Login/service failures and retry states are exposed in tested UI; there is no user-facing warning for production backup, privacy-encryption or unavailable future services (E3, E6, E14). |
| Safe integration | 84 | Local Keycloak/PostgreSQL/Kerno/Nodo, signed media access and restore integration are tested. Public edge, Matrix, LiveKit and production observability integration are not (E3, E5–E6, E11, E14). |

## Release blockers for the intended Kaordo suite

These blockers explain why the requested quality gate cannot be reached by polishing the existing Fluo/auth slice alone. They are product/readiness gaps, not claims of a demonstrated remote exploit.

| ID | Gap | Evidence needed to close |
| --- | --- | --- |
| B-01 | Ligo messaging, Rondo calls, full Regado administration, notifications and Settings workflows are not implemented; Matrix and LiveKit are not deployed. | Implement the scoped workflows and pass positive, negative and cross-module integration journeys. |
| B-02 | No production-like home-server deployment, Cloudflare Tunnel ingress, public TLS check, uptime monitoring or failover exists. | Deploy the documented topology in an isolated environment and test external reachability, TLS, recovery and operational alerts. |
| B-03 | Live backups restore only to disposable copies; repository/key separation, schedule and timed recovery drill are not configured. | Configure independent storage and a separately stored recovery key, then measure restore time and verify data integrity. |
| B-04 | Private-content encryption and its key lifecycle/recovery model are not implemented. | Define and test client/server key ownership, rotation, recovery and access-loss behavior before describing private content as encrypted. |
| B-05 | No representative feed, upload, storage or RTC load test and no availability SLO evidence exist. | Define workloads and targets, then publish repeatable load and failure results. |

## Dependency and library-use review

| Area | Finding |
| --- | --- |
| Frontend dependency ownership | `pnpm test:dependencies` checks all 13 app/package manifests: **26/26** checks pass. The package owning the import declares the runtime dependency, and workspace imports are direct. The check does not prove third-party package license compatibility or all transitive behavior (E7). |
| STaSBLR | Tailwind tokens and shadcn-svelte/Rhea components are centralized in `packages/ui`; Bits UI supplies behavior and Lucide supplies icons. Apps consume the shared package instead of repeating the UI setup (E15). |
| Fluo query and content | TanStack Query/Virtual are used for query-backed cursor feeds and rendering; Tiptap saves structured content. Tiptap loads dynamically when the composer mounts. |
| Fluo media | `packages/media-client` owns Uppy/Tus and Pica upload/resizing logic. PhotoSwipe loads only when a gallery contains media; Video.js is loaded for video playback. Fluo's static graph test protects the 100 KiB gzip budget (E4, E15). |
| API and identity | `openapi-fetch` consumes generated `@kaordo/contracts` types; Kerno uses chi, pgx and OIDC libraries in their owning Go module. Generated declarations are checked against the OpenAPI source (E8, E10, E15). |
| Nodo | tusd owns the resumable upload protocol; project code adds identity ownership, upload limits, processing and signed media access. Its integration is local; public ingress, storage replication and production load remain untested (E11, E14–E15). |
| Deferred services | Matrix Synapse and LiveKit remain documented choices/placeholders, not installed or represented as working integrations. `packages/crypto` is not evidence of private-content encryption (E14). |
| Vulnerabilities | The prior low `cookie@0.6.0` advisory was addressed by a workspace override to `0.7.2`. Current `pnpm audit --audit-level=low` and all three pinned Go `govulncheck` runs report no known vulnerabilities (E9). |
| Licenses | No root `LICENSE` exists. One transitive package has no npm `license` metadata although its packaged README says MIT; automated package metadata alone is not a complete license review (E13). |

## Refactor performed during this audit

- Overrode SvelteKit's affected transitive `cookie` range to patched `0.7.2`; the Low advisory no longer appears in `pnpm audit`.
- Changed the CI gates to run Go tests with `-race`, scan each Go module with pinned `govulncheck@v1.8.0`, and reject Low-or-higher npm advisories.
- Split Tiptap and media-client loading from Fluo's initial JavaScript; PhotoSwipe is not imported for posts without media. Added an artifact test that measures the gzip dependency graph and verifies those imports remain lazy.
- Updated the headless Fluo journey for the current navigation and added checks for saved posts, profile posts and text search.
- Enabled statement coverage output in the isolated Fluo PostgreSQL integration test; current result is 71.3% for that package.
- Corrected `docs/architecture.md` to describe the current Saved/Profile/Search navigation and distinguish real local services from documented placeholders.

## Conclusion

The implemented account and Fluo paths now have useful unit, database, headless browser, accessibility, API-contract, backup and dependency evidence. The Fluo first-load JavaScript budget is enforced, the discovered Low npm advisory is fixed, and the current npm/Go vulnerability scans are clean.

The current repository scores **78.4/100**, with Performance efficiency lowest at **67.3/100**. None of the nine characteristics reaches 95. The intended suite still has unimplemented modules and lacks production ingress, private-content encryption, independent backup recovery and representative scale/availability evidence. Therefore the requested **≥99 overall / ≥95 each / no Critical or High blockers** condition is **not met**, and the current code must not be described as a production-ready or secure-messaging release.
