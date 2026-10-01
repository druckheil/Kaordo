# Kaordo implemented-scope audit — ISO/IEC 25010:2023

**Date:** 2026-10-01. **Quality Score: 87.8/100. Lowest characteristic: Security, 80.5/100.** The requested ≥99 overall, ≥95 in every category and no High issues is **not met**. No Critical code defect was confirmed. An independent recovery copy is still missing and is a **High operational release blocker** for real user data.

## Scope and method

The assessment covers the implemented local account/SSO/TOTP, Fluo and Nodo slice, shared packages, static Pages artifact and local tooling. Ligo, Rondo, Regado, notifications, full Settings, Matrix, LiveKit and public Cloudflare ingress are placeholders or plans; they are identified as boundaries but do not lower functional completeness for this implemented slice. [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) supplies nine product-quality characteristics. ISO does not define this report's numerical scores or certify them.

Rubric: 0–49 absent/mostly unverified; 50–69 partial controls; 70–84 working local evidence with substantial gaps; 85–94 integrated checks of representative normal and failure paths; 95–100 repeated production-like security, scale, accessibility and recovery evidence. Each subcharacteristic is scored 0–100; characteristic means and the unweighted mean of all nine form the final score. These are evidence-based engineering judgments, not statistically precise measurements.

| Characteristic | Score |
| --- | ---: |
| Functional suitability | 91.7 |
| Performance efficiency | 88.0 |
| Compatibility | 91.5 |
| Interaction capability | 88.3 |
| Reliability | 83.0 |
| Security | 80.5 |
| Maintainability | 91.4 |
| Flexibility | 87.5 |
| Safety | 88.0 |
| **Quality Score** | **87.8** |

## Evidence ledger

| ID | Reproducible evidence | Result and limit |
| --- | --- | --- |
| E1 | `pnpm check:front` | Six Svelte projects: zero errors/warnings. Type checking is not behavioral proof. |
| E2 | `pnpm test:auth`, `test:dependencies`, `test:ui-layout`, `test:backup`, `test:dev` | 31 auth, 42 dependency, 3 media layout, 4 backup config and 2 launcher tests pass. Two launcher scenarios skip because the user's existing server owns the ports. |
| E3 | `pnpm test:fluo:db` | Disposable PostgreSQL database with migrations 001–006: post/media/authorization/concurrent-delete/literal-search tests pass; PostgreSQL package coverage 73.0%. A local 20,000-post/100-author/40-read fixture measured Latest p95 **1.067 ms**, selective search p95 **4.451 ms**. These are local reads, not network or sustained-load figures. |
| E4 | `go test -race ./services/kerno/... ./services/nodo/... ./services/mediaauth/...`, `go vet ...`, `go build ...` | All pass. Standalone coverage without the DB fixture: Fluo validation 60.9%, HTTP API 46.6%, identity 85.2%, Nodo upload 70.0%, media authorization 79.4%. Command packages have no direct tests. |
| E5 | `pnpm test:pages` | Five artifact assertions pass after building the static apps. Fluo initial JS graph: **94,563 gzip bytes** under the 100 KiB budget. Tiptap, media client, PhotoSwipe and Vidstack load lazily. This does not measure Core Web Vitals. |
| E6 | `pnpm test:auth:live` | One headless registration/TOTP/recovery/Fluo/media/SSO journey passes when run alone; 32 concurrent local account lookups measured p95 **10 ms**. A first attempt timed out while `test:pages` rebuilt the served artifact concurrently, so these commands must be serialized. Already-running Kerno/Nodo binaries were not restarted; E3–E4 cover changed service code. Axe covers only visited states. |
| E7 | `pnpm test:backup:live`; `diskutil list external physical`; presence check for `RESTIC_REPOSITORY` | One encrypted restic backup restores both databases into disposable copies. No external physical disk was listed and no restic repository environment variable was set in this session. No independent destination, separate password copy, schedule or active-site recovery drill is configured. |
| E8 | `pnpm audit --audit-level=low`; pinned `govulncheck@v1.8.0` in all three Go modules | No **known published** npm or Go vulnerability reported. No scan rules out application defects or unpublished advisories. |
| E9 | `pnpm --filter @kaordo/contracts generate`; `git diff`; `.github/workflows/checks.yml` | Generated OpenAPI declarations match source. The CI workflow requests type/build/race/vulnerability/database/layout checks; no hosted run was observed. |
| E10 | `pnpm licenses list --json`; package manifests/imports | All 42 direct-import declarations pass. Npm metadata reports 202 MIT packages and other open-source licenses. `combine-errors@3.0.3` reports Unknown metadata, but its packaged README says MIT. No root `LICENSE` defines Kaordo's distribution terms. |
| E11 | Migrations 005/006 and Kerno/Nodo sources/tests | Final media deletion serializes against creation; Nodo has a 23-hour acceptance/24-hour collection gap; quota use is indexed at startup and updated on mutation; indexed substring search preserves literal wildcard semantics. |

No manual site exploration was performed. The headless journey is an automated test. No public deployment, soak, cross-browser/device matrix, assistive-technology study, external penetration test, production alerting, independent backup or off-host restore was performed.

## Characteristic and subcharacteristic scores

### Functional suitability — 91.7

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Functional completeness | 91 | Implemented registration, TOTP/recovery, account session, Fluo create/reply/quote/react/follow/search/save/delete and image/video media (E3, E6). Placeholder apps are outside this slice. |
| Functional correctness | 93 | DB, headless, contract, race and media tests cover privacy, claims, deletion and recovery (E2–E6, E9–E11). HTTP API unit coverage is 46.6%. |
| Functional appropriateness | 91 | Latest, Following, Search, Saved and Profile serve the current small network (E6). No user-outcome study or relevance model exists. |

### Performance efficiency — 88.0

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Time behaviour | 91 | Measured 20,000-post reads, 10 ms local account p95 and <100 KiB Fluo initial JS (E3, E5–E6). No cold load, INP, remote RTT or upload p95. |
| Resource utilization | 89 | Sequential image preprocessing, lazy feature imports and indexed Nodo quotas (E5, E11). No sustained CPU/RAM/disk/transcode profile. |
| Capacity | 84 | 20,000 posts/100 authors and four-media journey (E3, E6). Two-character search, large collections, simultaneous uploads and multi-node load are unbounded. |

### Compatibility — 91.5

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Co-existence | 92 | Five separately built apps assemble into one Pages artifact; local identity/Kerno/Nodo/database coexist (E1, E5–E6). Other host OS/browser combinations untested. |
| Interoperability | 91 | OIDC/Keycloak, tusd, PostgreSQL and OpenAPI clients integrate locally (E3, E6, E9). Tunnel, Matrix and LiveKit are not implemented. |

### Interaction capability — 88.3

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Appropriateness recognizability | 90 | Current auth and Fluo controls are labeled and exercised (E6); planned destinations remain explicitly unavailable. |
| Learnability | 88 | Registration, TOTP and posting paths are covered (E6); no first-time-user study. |
| Operability | 91 | Dialogs, carousel, keyboard actions, feed navigation and account state are exercised (E2, E6); no assistive-device matrix. |
| User error protection | 90 | Validation, ownership, limits, retry and destructive confirmation have tests (E2–E4, E6); no broad adversarial usability exercise. |
| User engagement | 87 | Posts, media, discussion, saved items and profiles form a coherent local loop (E6); engagement was not measured. |
| Inclusivity | 87 | Axe reports zero A/AA findings in visited states; reduced-motion CSS and alt-text fields exist (E6, source). Manual screen-reader/contrast assessment remains. |
| User assistance | 83 | Auth/recovery/error feedback exists (E6); contextual help and operations support are thin. |
| Self-descriptiveness | 90 | Labeled actions, progress and error states appear in exercised routes (E2, E6); user comprehension was not assessed. |

### Reliability — 83.0

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Faultlessness | 92 | Type/race/DB/media/live/restore tests and vulnerability scans pass after repair (E1–E9). Local tests cannot exclude untested failures. |
| Availability | 72 | Loopback health checks and a local launcher exist (E2, E6); no deployed SLO, monitoring, redundancy or failover result. |
| Fault tolerance | 86 | Session retry, resumable uploads, fail-closed claims, bounded creation, cleanup and backup checks (E2–E4, E7, E11). Disk/network partitions untested. |
| Recoverability | 82 | Disposable encrypted restore passes (E7), but an actual independent destination and password copy are absent. |

### Security — 80.5

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Confidentiality | 87 | OIDC, account gates, private-post queries, owner checks and signed URLs are tested (E3–E6). Private content is not encrypted at rest/end to end; that is a future requirement. |
| Integrity | 92 | Parameterized SQL, token verification, FK/claim transactions, dimensions and restore checks (E3–E4, E7, E11); no cross-service reconciliation drill. |
| Non-repudiation | 55 | Stable subjects/post ownership exist, but no tamper-evident action trail or signed receipt can prove a disputed action. |
| Accountability | 68 | Identity maps to UUIDv7 accounts; current logs are not a retained admin audit log with access/retention controls. |
| Authenticity | 93 | PKCE/OIDC issuer/audience/subject, TOTP/recovery and internal signatures pass local tests (E2, E4, E6); no production federation/device lifecycle evidence. |
| Resistance | 88 | Known-advisory scans are clean; origin, token, payload, rate, quota and upload bounds exist (E2–E4, E8). No external penetration or public abuse/DoS test. |

### Maintainability — 91.4

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Modularity | 93 | Separate SvelteKit apps, shared packages and independent Go modules own distinct functions (E1, E9–E11). |
| Reusability | 92 | UI/auth/API/contracts/media are shared; no duplicate custom editor/upload/video engine was found (E10–E11). |
| Analysability | 92 | Docs, generated contracts, one migration list, coverage and repeatable tests aid diagnosis (E1–E11); deployed telemetry absent. |
| Modifiability | 91 | Direct-import checks, migrations, contracts and lazy boundaries constrain change impact (E2–E3, E9–E11). |
| Testability | 89 | Disposable DB, headless and restore tests exist (E2–E7); uninstrumented command packages and HTTP API's 46.6% unit coverage limit confidence. |

### Flexibility — 87.5

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Adaptability | 92 | Independent apps and OIDC/OpenAPI/tus boundaries support evolution (E1, E3, E9–E11); other topologies untested. |
| Scalability | 83 | Indexed search/quota, cursor pages and 20,000-post fixture (E3, E11); no million-post, upload soak or horizontal-scale result. |
| Installability | 88 | `pnpm dev`, Compose, static build and migrations work locally (E2–E6); no clean production-host rehearsal. |
| Replaceability | 87 | Standards-based boundaries reduce provider lock-in (E9–E11); no provider migration drill. |

### Safety — 88.0

This is not a safety-critical product, but account exposure and data loss are relevant.

| Subcharacteristic | Score | Evidence and limit |
| --- | ---: | --- |
| Operational constraint | 88 | Local endpoints bind to loopback; request/upload size, token and per-user quota limits exist (E4, E11). Public ingress policy absent. |
| Risk identification | 88 | Media race, quota growth, search scans and backup independence were assessed; code risks repaired (E7, E11). No maintained operational risk register. |
| Fail safe | 91 | Invalid ownership, corrupt quota metadata, unavailable account state and retired claims fail closed in tests (E2–E4, E11). |
| Hazard warning | 85 | Auth, upload and destructive-action feedback exists (E6); no failed scheduled-backup alert because scheduling is absent. |
| Safe integration | 88 | Local Keycloak/PostgreSQL/Kerno/Nodo and restore integrate (E3, E6–E7); external ingress and telemetry unverified. |

## Third-party implementation check

| Function | Actual use and duplication finding |
| --- | --- |
| STaSBLR | SvelteKit, Tailwind tokens, shadcn-svelte component sources, Bits UI dialog behavior and Lucide icons live in their owning packages. `packages/ui/components.json` selects `style: rhea`; Rhea is a shadcn-svelte **style preset**, not another runtime package ([official announcement](https://www.shadcn-svelte.com/docs/changelog)). Local component overrides mean pixel parity with upstream is not asserted. |
| Feed/editor | TanStack Query/Virtual, Embla and Tiptap are imported in Fluo. Editor code is lazy and structured JSON is validated server-side; no custom virtualizer or rich-text parser was added. |
| Media | Uppy/Tus and tusd implement transfer; Pica resizes images; PhotoSwipe presents photos; Vidstack plays video. Old Video.js documentation was inaccurate and is corrected. Custom code handles Kaordo authorization, quotas, processing, metadata and lifecycle. |
| Identity/storage/API | Keycloak/OIDC handles password/TOTP/recovery; pgx uses PostgreSQL; chi routes Kerno; `openapi-fetch` consumes generated types. Application code handles identity mapping and domain rules. |
| Dependency hygiene | Every checked source import is declared directly (E2). No known advisory appears in npm/Go scans. `combine-errors` metadata and Kaordo's missing root license still need distribution review (E8, E10). |

## Findings and refactoring

| Severity | Finding | Status |
| --- | --- | --- |
| **High operational** | Restic restore works only with temporary/local storage. Loss of the primary disk can lose real accounts/media without an independent destination and separately stored key (E7). | **Open**; requires actual independent storage and recovery drill. |
| Medium | Final media deletion could race with reattachment and Nodo purge. | **Fixed:** locked/retired claims, 23-hour acceptance/24-hour cleanup gap and bounded Kerno creation; sequential/concurrent DB tests pass (E3, E11). |
| Medium | Nodo scanned all `.info` files on every upload. | **Fixed:** startup reconciliation and atomic usage updates; race/restart/corrupt-metadata tests pass (E4, E11). |
| Medium | Substring search scanned posts and literal wildcards were untested. | **Fixed:** PostgreSQL `pg_trgm` candidate search and wildcard tests; selective 20,000-post local p95 4.451 ms (E3). |
| Low | Four image decodes/resizes ran in parallel, multiplying transient memory. | **Fixed:** sequential preprocessing; four-media headless flow passes (E6). |
| Low | Dependency test missed undeclared external/script imports; migration lists diverged; docs named unused Video.js. | **Fixed:** 42 import assertions, one migration list, accurate Vidstack docs (E2, E10). |
| Evidence gap | Headless and encrypted restore journeys pass locally but are not hosted-CI gates; one concurrent-build test attempt timed out (E6–E7, E9). | Open; use a dedicated built artifact and service stack in CI. |

The current implemented slice is measurably improved, with no confirmed Critical code defect or known published dependency advisory. **87.8/100**, Security **80.5**, Reliability **83.0** and the open **High recovery gap** prevent an honest 99/95/no-High claim.
