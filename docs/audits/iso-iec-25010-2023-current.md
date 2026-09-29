# Kaordo product quality audit — ISO/IEC 25010:2023

**Audit date:** 2026-09-29. **Scope:** current `scope-0.0.1` working tree, including the account slice and reserved-but-unimplemented Ligo, Fluo, Rondo, Nodo and Regado areas. **Result:** Quality Score **61.3/100**, lowest characteristic **48.0/100**, **0 demonstrated Critical vulnerabilities and 3 High release blockers**. The requested gates (≥99 overall, every characteristic ≥95, no Critical/High) are **not met**. This is a code-and-test engineering assessment, not ISO certification.

[ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) defines the nine-characteristic product-quality model; ISO does not prescribe this audit's score or passing threshold. Ratings below use an explicit 0–100 engineering rubric: 0–20 absent/planned; 21–45 partial/static; 46–70 working narrow flow with focused tests; 71–94 representative integrated verification; 95–100 production-like acceptance targets met with functional, failure, accessibility, security and load evidence. Subcharacteristics within each characteristic are equally weighted; nine characteristics are equally weighted in the overall score. Ratings are rounded to one decimal only in summaries. They reflect evidence and substantial feature gaps; they are not statistical measurements.

No manual website interaction was performed. Evidence came from source/configuration review, dependency and advisory scans, type checks, builds, unit tests, headless integration tests, and disposable-database restoration. No public Tunnel, production topology, RTC, representative user load, real-world backup destination, assistive device or recovery into active databases was tested.

## Score summary

| ISO/IEC 25010:2023 characteristic | Score |
| --- | ---: |
| Functional suitability | **54.0** |
| Performance efficiency | **48.0** |
| Compatibility | **66.5** |
| Interaction capability | **65.8** |
| Reliability | **62.5** |
| Security | **53.8** |
| Maintainability | **81.2** |
| Flexibility | **57.0** |
| Safety | **63.2** |
| **Quality Score** | **61.3** |

## Evidence ledger

| ID | Verifiable evidence | What it proves / does not prove |
| --- | --- | --- |
| E1 | `AGENTS.md`, `README.md`, `docs/architecture.md`, app routes and service entry points | Five independent SvelteKit apps and two Go modules exist. Account access is implemented; messaging/feed/communities/file-storage/admin workflows remain stubs. |
| E2 | `pnpm check:front` | Six frontend projects type-check with **0 errors and 0 warnings**. Vite prints its expected SvelteKit `root` override notices. |
| E3 | `pnpm test:auth` | **31/31** unit tests pass, including login configuration, TOTP/recovery policy reconciliation, API retry, preview-cache privacy, session refresh, cancellation and late-response races. |
| E4 | `pnpm test:auth:live` with the existing local Compose stack and headless browser | **1/1** integrated journey passes: registration, TOTP and recovery login, Kerno account lookup, app SSO, sign-out, reused recovery-code rejection and account-cache/session transitions. It also reports zero automated axe-core WCAG A/AA violations for the tested states and checks a narrow keyboard path. A local run of 32 concurrent account lookups measured **11 ms p95**. This is a local identity endpoint result, not a product capacity or page-performance test. The temporary test user is removed. |
| E5 | `pnpm test:backup` and `pnpm test:backup:live` | Unit tests **4/4**; live encrypted restic/PostgreSQL check **1/1**, including restore to disposable databases and data checks. No independent repository, separate key copy, recurring schedule or active-database recovery drill is configured. |
| E6 | `pnpm test:pages` | All five frontend builds complete; **4/4** static-artifact checks pass, including prerendered app routes, auth entry states, Keycloak silent-SSO callback and local asset references. |
| E7 | `pnpm test:dependencies` and the direct-import inventory | **24/24** checks pass across 12 workspace packages; all **32/32** declared runtime dependencies are referenced in their owning package source, and workspace packages are declared directly. Removing 42 unused declarations pruned **136 installed packages** and 1,217 lockfile lines. Deferred feature libraries are no longer installed until implementation needs them. |
| E8 | `pnpm audit --audit-level=moderate`, `pnpm audit --audit-level=low`, `pnpm licenses list --json` | No npm Moderate/High/Critical advisories; one Low transitive `cookie@0.6.0` advisory remains through SvelteKit ([GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x)). The pruned npm tree reports **135 package records** with metadata under MIT, Apache-2.0, BSD-3-Clause, ISC, MPL-2.0, OFL-1.1, Python-2.0, 0BSD, or MIT/CC0. This does not audit Go or container licenses, nor grant a license to Kaordo itself. |
| E9 | `go test ./services/kerno/... ./services/nodo/...`, `go vet ...`, `go build ...` | Both Go modules test, vet and build. Kerno has the active account API; Nodo's tusd handler is constructed but not mounted and has no authentication, ownership or quota admission. The Go code was unchanged by this refactor. |
| E10 | Local Compose, Keycloak realm configuration, PostgreSQL schema, Kerno routes and backup scripts | Demonstrates a local identity/account stack with OIDC/JWT verification, parameterized pgx access, loopback development binding and local backup/restore tooling. It is not production deployment evidence. |
| E11 | `pnpm test:dev` | **1 passed, 2 skipped** because the user's existing local services already occupy the Kerno/site ports. No process was stopped. Port preflight runs; the two destructive duplicate-launch checks were not repeated in this run. |
| E12 | `.github/workflows/checks.yml` | Least-privilege push/PR checks include frontend, API contract, account/backup/dependency/dev/Pages tests and Go test/vet/build. The workflow was not run by hosted CI in this audit; `actionlint` is unavailable in the local environment. |
| E13 | `packages/ui`, `packages/account-ui`, `packages/auth`, `packages/api-client`, `packages/contracts` | The STaSBLR system is centralized: Tailwind and shadcn-svelte/Rhea configuration, Bits UI behavior, Lucide icons and shared account/session/API contracts. The shared session controller now guards stale responses and logout cancellation; account preview stores display metadata only, not tokens. |

## All characteristics and subcharacteristics

| Characteristic / subcharacteristic | Score | Evidence-based assessment |
| --- | ---: | --- |
| **Functional suitability** | **54.0** | Mean of its three subcharacteristics. |
| Functional completeness | 31 | Registration/login/TOTP/account bootstrap exist, but chat, feed, calls, file sharing and admin functions are absent (E1, E4, E9). |
| Functional correctness | 73 | Focused and live auth paths, recovery-code behavior, session races, builds and service checks pass; domain behaviors do not exist to verify (E2–E6, E9). |
| Functional appropriateness | 58 | A shared account session unlocks each app and gives useful error/retry states; there are no domain tasks (E1, E4, E13). |
| **Performance efficiency** | **48.0** | Mean of its three subcharacteristics. |
| Time behaviour | 57 | Kerno lookup p95 is 11 ms for 32 local concurrent requests; auth flow is integrated. No cold-start, page CWV, upload, feed, chat or RTC latency targets/results (E4, E6). |
| Resource utilization | 62 | Removing unused dependencies pruned 136 installed packages; apps build as separate artifacts. No CPU, memory, bandwidth or DB-profile measurements (E6, E7). |
| Capacity | 25 | A modest 32-request identity lookup is the only concurrency evidence; no representative data volume, user load, storage capacity or load target exists (E4, E9). |
| **Compatibility** | **66.5** | Mean of its two subcharacteristics. |
| Co-existence | 72 | Five apps build independently into the Pages route set; the local app/services detect occupied ports. Multi-version/runtime coexistence is not tested (E6, E11). |
| Interoperability | 61 | OIDC/Keycloak, PostgreSQL and OpenAPI/Kerno are exercised in local integration. Matrix, LiveKit, tus upload and Tunnel are not integrated (E4, E9, E10). |
| **Interaction capability** | **65.8** | Mean of its eight subcharacteristics. |
| Appropriateness recognizability | 73 | App names, account purpose, loading, unavailable-service and retry states are clear; most domain pages are placeholders (E1, E6). |
| Learnability | 62 | English auth flow, setup guidance and recovery-code journey work in a headless run; domain onboarding is absent (E4). |
| Operability | 69 | Sign in, registration, retry, sign out and shared account gates operate in integration tests; domain controls are absent (E4, E13). |
| User error protection | 70 | Registration inputs, TOTP setup, one-time recovery-code rejection and session-error paths have targeted tests; there is no broader domain validation (E3, E4). |
| User engagement | 52 | Shared STaSBLR components and loading/feedback states exist, but there is no working feed, dialogue or user feedback evidence (E1, E6, E13). |
| Inclusivity | 62 | axe-core found zero automatic A/AA violations in tested states; tab/Enter path is narrow. No complete keyboard, screen-reader, contrast or assistive-device validation (E4). |
| User assistance | 62 | Auth prompts, errors, retry, recovery setup and local setup docs are present; no domain help/support paths (E1, E4). |
| Self-descriptiveness | 76 | Each current account state labels what happened and available action; future service behavior remains unspecified (E4, E13). |
| **Reliability** | **62.5** | Mean of its four subcharacteristics. |
| Faultlessness | 80 | Frontend checks, 31 auth tests, 4 backup tests, 24 dependency checks, 4 artifact checks, live auth/backup checks and Go build/test/vet pass (E2–E9). |
| Availability | 32 | Local services have health checks and a usable dev stack; there is no production rollout, uptime SLO, alerting or failover evidence (E10, E12). |
| Fault tolerance | 66 | Token refresh-on-401, one bounded retry, stale-response cancellation and backup verification are tested; no disk-full, service-loss, network-partition or quota behavior for product modules (E3–E5). |
| Recoverability | 72 | TOTP recovery-code login and encrypted backup restore into disposable databases pass; the real backup destination/key copy/schedule and active restoration remain unconfigured (E4, E5). |
| **Security** | **53.8** | Mean of its six subcharacteristics. No Critical or High exploitable vulnerability was demonstrated by the scoped source/test audit. |
| Confidentiality | 67 | OIDC bearer auth, in-memory session tokens, metadata-only preview and encrypted restic repository test are evidenced; private-content encryption and public TLS/ingress configuration are absent (E4, E5, E10, E13). |
| Integrity | 72 | OIDC signature/issuer/audience checks, parameterized SQL, schema constraints, token-refresh tests and backup restore checks provide evidence; content-level integrity/reconciliation is incomplete (E3–E5, E9). |
| Non-repudiation | 8 | No signed event receipts or immutable evidence for sensitive product actions (E1, E9). |
| Accountability | 32 | Identity maps OIDC subject to stable local UUID and the test identity can be traced; no admin/action audit trail or retained operational logs (E4, E9). |
| Authenticity | 82 | PKCE and live registration/TOTP/recovery login, JWT/JWKS/issuer/audience checks and reused-code rejection pass. No production federation or enrolled-device hardening evidence (E3, E4, E10). |
| Resistance | 62 | Keycloak brute-force policy, origin checks, bearer enforcement, error-safe session handling and one Low dependency advisory are evidenced; no public abuse controls, upload admission, rate/quota or adversarial load tests (E4, E8–E10). |
| **Maintainability** | **81.2** | Mean of its five subcharacteristics. |
| Modularity | 84 | Separate SvelteKit apps, shared packages and independent Go modules have clear ownership; several domain modules are still empty scaffolds (E1, E9, E13). |
| Reusability | 84 | Account/session resolver, UI, auth/API clients and contracts are shared rather than copied; reuse is limited to account flows (E3, E13). |
| Analysability | 76 | Explicit architecture docs, unit/live checks, artifact tests, Go vet and dependency/advisory scans improve diagnosis; no deployed telemetry and hosted CI evidence (E2–E12). |
| Modifiability | 79 | Removing 42 unused declarations and centralizing session lifecycle lowers change surface; live integration coverage only exists for account/backup slices (E4–E7, E13). |
| Testability | 83 | Injectable account dependencies, fast race tests, headless auth, disposable backup restore and independent app builds support repeatable checks; domain modules remain untested because absent (E2–E9). |
| **Flexibility** | **57.0** | Mean of its four subcharacteristics. |
| Adaptability | 69 | Workspace apps/packages and independent Go services can evolve separately; only the local identity topology has a runnable integration (E1, E9, E10). |
| Scalability | 25 | No feed/chat/storage/RTC scale design or representative load data; a small auth lookup result is not scale evidence (E4, E9). |
| Installability | 72 | `pnpm dev`, Compose, standalone Pages artifact and documented backup commands work locally; no clean-host production install/deployment proof (E5, E6, E10). |
| Replaceability | 62 | OpenAPI/OIDC contracts and package boundaries help replace providers; no provider migration, user export/import or replacement test (E9, E10, E13). |
| **Safety** | **63.2** | Mean of its five subcharacteristics; product is not safety-critical, but account/storage loss and unsafe public exposure are operational hazards. |
| Operational constraint | 52 | Local development binding and authenticated Kerno paths constrain present exposure; no public ingress, quota or storage guardrail (E9, E10). |
| Risk identification | 64 | This evidence-based audit identifies feature, backup, ingress and upload risks; there is no maintained hazard/abuse register or operational owner (E8–E12). |
| Fail safe | 75 | Invalid/missing bearer, bad origin, unavailable account service and stale session response fail closed; future Nodo handler is not safe to expose yet (E3, E4, E9, E13). |
| Hazard warning | 70 | UI presents sign-in, service failure and retry states; backup destination absence and future storage/RTC failures are not surfaced to users (E4, E5, E13). |
| Safe integration | 55 | Local Keycloak/Postgres/Kerno and restore integration are checked; no public edge, object-storage, RTC or multi-service production test (E4, E5, E9, E10). |

## High-priority release blockers

High here means a blocker for the intended Kaordo suite, not a claim of current remote exploit. No Critical or High exploitable dependency advisory was reported; the following product gaps still prevent the requested quality gate.

| ID | Severity | Finding and closure evidence |
| --- | --- | --- |
| H-01 | **High** | Core Ligo/Fluo/Rondo/Nodo/Regado tasks are absent. Implement and verify representative positive/negative end-to-end journeys. |
| H-02 | **High** | No production-like local-server ingress, Cloudflare Tunnel, public TLS, RTC/TURN or reachability test. Validate the intended deployment before exposing user data. |
| H-03 | **High** | The tested backup restore is disposable only; no independent repository, separately stored key copy or schedule is configured. Configure these and pass a timed recovery drill against an isolated copy before real user data. |
| M-01 | Medium | Nodo's tusd handler has no auth, file ownership, quota, cleanup or publication gate and is unmounted. Add and test the gates before mounting it. |
| M-02 | Medium | No root `LICENSE` is present; dependency license metadata does not license the product repository. Choose and add the intended project license before distribution. |
| M-03 | Medium | No representative load, availability SLO/telemetry, full accessibility or production installation proof. Set targets and gather these before a release score above 95. |
| L-01 | Low | SvelteKit brings `cookie@0.6.0`, below the advisory's patched `0.7.0` floor. Keep tracked for an upstream-compatible update; no moderate-or-higher npm advisory appears (E8). |

## Dependency and library-use audit

The source-reference check walks `.css`, `.js`, `.svelte` and `.ts` source files in each `apps/*` and `packages/*` package. It verifies every direct runtime dependency has a source import and every imported `@kaordo/*` package is declared directly. It is intentionally not a claim about transitive imports, dynamic plugin loading or Go dependencies.

| Area | Current evidence and conclusion |
| --- | --- |
| Runtime dependency ownership | **32/32** direct runtime declarations are referenced in their owning package; **0/32** are currently dead declarations by this check. The test is wired into the CI workflow. |
| Deferred domain libraries | TanStack Query/Virtual, Matrix SDK, LiveKit, Tiptap, Uppy/tus client, PhotoSwipe, Pica, Video.js and libsodium are not installed as unused promises. Add each to its owning package when implementation imports it; do not write substitute functionality preemptively. |
| STaSBLR | Shared UI package owns Tailwind, shadcn-svelte/Rhea setup, Bits UI behavior, Lucide icons and Inter. Current app imports resolve through that package and successful build/check confirms integration; no claim that unbuilt interaction types are proven accessible beyond E4. |
| Authentication | `keycloak-js`, `go-oidc`, `chi`, `pgx`, `openapi-fetch` and generated contracts are used by the login/account flow and covered by automated checks. Keycloak owns passwords/TOTP; Kaordo does not create its own credential or cryptography subsystem. |
| File uploads and media | Go has a tusd handler scaffold, currently unmounted and unguarded. Uppy/PhotoSwipe/Pica/Video.js are deferred. No resumable upload, ownership, media processing or secure file sharing is implemented. |
| Encryption | The placeholder crypto package has no unused libsodium runtime dependency. There is no private-content encryption, Matrix E2EE or recovery model in the current code. |
| Licenses | Current npm license report has 135 package records with stated metadata; Go transitive modules, container images and the repository license need separate review (E8, M-02). |

## Refactor performed and quality conclusion

- Removed **42** unused direct runtime dependencies and their lockfile entries; the installed package set dropped by **136** packages. Feature libraries are documented as deferred, not presented as integrated.
- Added `pnpm test:dependencies` (24 checks) and wired it into the repository check workflow so unused runtime declarations and undeclared Kaordo workspace imports are caught.
- Made account snapshot loading side-effect free. The shared controller now writes or clears its display-only preview only after confirming the response is current; cancellation on sign-out prevents a late response from repopulating it. Added regression coverage for stale responses, cancellation and disposal.
- Unified the portal's session refresh with the same controller used by app account gates. Exported the controller from `@kaordo/account-ui`; frontend type-check caught and verified this public API wiring.
- Updated architecture docs to match what the repository imports and actually implements.

The **current login/registration/account bootstrap** is a reasonably well-tested prototype path: 31 focused auth tests, one live registration/TOTP/recovery/SSO journey, session-race regression checks, no guest-action flash in the tested states, and zero automatically detected axe A/AA violations in those states. That does not make the intended Kaordo suite 99/100: most product functions are absent, the only performance result is a small local account lookup, real backup operations are not configured, the public deployment and storage paths are untested, and one Low transitive advisory remains. Current overall score is **61.3/100**; the full requested thresholds and no-High gate are not satisfied.
