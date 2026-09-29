# Kaordo product quality audit — ISO/IEC 25010:2023

**Baseline audited:** 2026-09-29, `scope-0.0.1` at `7e993d8`. Results below score the checkout before the authentication fixes described in the post-fix evidence section. The earlier `iso-iec-25010-2023-scope-0.0.1.md` remains a historical audit of the pre-authentication scaffold.

**Baseline decision:** Quality Score **39.3/100**; minimum characteristic **24.3/100**; **0 Critical, 5 High** release blockers. The requested gates (overall ≥98, every characteristic ≥95, no Critical/High) were **not met**. This is an engineering assessment, not ISO certification. It scores the intended Kaordo suite: the working account slice receives credit; absent Ligo, Fluo, Rondo, Nodo and Regado workflows do not. Post-fix evidence closes two findings but does not establish a 100/100 score.

[ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) supplies the nine-characteristic product-quality model, not a 0–100 formula or a required passing score. Names follow the [2023 preview](https://cdn.standards.iteh.ai/samples/78176/13ff8ea97048443f99318920757df124/ISO-IEC-25010-2023.pdf). Every subcharacteristic is rated against the intended product: 0–20 absent/planned; 21–45 partial/static; 46–70 working narrow flow with focused tests; 71–94 representative integrated verification; 95–100 documented acceptance targets met with production-like functional, failure, accessibility, security and load evidence. Characteristic scores are unweighted means of their subcharacteristics; the overall score is the unweighted mean of nine characteristics. Intermediate points express engineering judgment tied to evidence, not statistical precision.

No manual website interaction was performed. The baseline review used source, configuration, generated artifacts and automated tests, but did not run the live Keycloak/PostgreSQL journey. The post-fix work used the running local Docker stack and automated headless browser and disposable-restore tests. No public endpoint, Tunnel, RTC, assistive device, representative load or recovery into active databases was tested.

## Evidence ledger

| ID | Reproducible evidence |
| --- | --- |
| E1 | `README.md`, `AGENTS.md`, `docs/architecture.md` and the four domain app `+page.svelte` files: five independently built SvelteKit apps; only shared account access is functional; messaging, feed, communities and administration say “not available yet.” |
| E2 | `pnpm check:front`: six Svelte projects, **0 errors/0 warnings**. `pnpm test:pages`: five builds and **3/3** artifact tests pass. `node --test scripts/*.test.mjs`: **20/20** pass, including those three artifact tests. `dist/pages`: **111 files**, **2.8 MiB on disk**; size is not a page-load or transfer metric. |
| E3 | `go test -cover ./services/kerno/... ./services/nodo/...`, `go vet ./services/kerno/... ./services/nodo/...`, and `go build ./services/kerno/... ./services/nodo/...` pass. Kerno HTTP and OIDC package statement coverage: **81.7%** and **85.2%**; Kerno entrypoint/Postgres and both Nodo packages: **0%**. These are package-local coverage figures. |
| E4 | `packages/auth`, `api-client`, `contracts`, `services/kerno/internal/{httpapi,identity,postgres}`: Keycloak JS Authorization Code/PKCE, one forced refresh after 401, typed `openapi-fetch`, go-oidc signature/issuer/audience/expiry validation, authenticated user upsert/lookup, parameterized pgx queries, origin allowlist and `no-store` responses. Tests cover selected bearer/JWKS/retry/error cases. Regenerating OpenAPI types caused no diff. |
| E5 | `deploy/local/compose.yaml`, Keycloak realm/profile JSON, `deploy/postgres/001_users.sql`, `scripts/{dev-local,sync-keycloak}.mjs`: localhost-only development Keycloak/PostgreSQL, UUIDv7 user IDs, PKCE S256, configured default TOTP action and brute-force protection. Initial realm JSON is imported only into an empty realm; sync repairs profile/scopes/audience, **not** TOTP policy or password policy on an existing realm. No live integration proof here. |
| E6 | `services/nodo/cmd/nodo/main.go` logs a scaffold message. Its tusd handler is constructed but unmounted and has no auth/quota admission. `deploy/{cloudflare,livekit,synapse,storage,observability}` hold README plans, not operational configurations. |
| E7 | Direct runtime dependency source-reference inventory: **74** declarations across `apps/*` and `packages/*`; **32** referenced in the declaring package's `src/`, **42** without a direct source reference. This is not a bundle-size or transitive-use count. Kerno production uses chi, pgx and go-oidc; its direct go-jose dependency is test-only. Nodo only constructs an unused tusd handler. |
| E8 | `pnpm audit --audit-level=low` and `pnpm audit --prod --audit-level=low`: **one Low** transitive `cookie@0.6.0` advisory ([GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x)); no reported Moderate/High/Critical npm advisory. `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` in each Go module: **No vulnerabilities found**. Container images, config and unknown vulnerabilities are outside these scans. |
| E9 | Tracked files contain no CI workflow, project `LICENSE`, integrated stack test, browser accessibility test, capacity benchmark, threat model, backup/restore drill or operations telemetry. Five tracked test-source files exist; Go tests target HTTP/OIDC only. |
| E10 | `packages/ui/components.json` selects Rhea/Lucide. Actual code imports Tailwind, shadcn-svelte CSS, Bits UI Dialog primitives, Lucide icons, Inter and generated Button/Input/Dialog. Pages use Button and icons; no application Dialog/input behavior or automated assistive-technology test is shown. |
| E11 | Portal/AuthScreen/AccountGate source displays a session-check state before guest actions, account/error text and retries. `AccountGate.refresh()` does not clear an already loaded `user` before a later failed refresh, so a future private view could retain stale content. Current scaffold pages reveal only a display name. |
| E12 | `pnpm licenses list --json`: 263 installed npm package records grouped by license; 262 have recognized license metadata and one, `combine-errors@3.0.3`, is “Unknown” in package metadata. Its [upstream README](https://github.com/matthewmueller/combine-errors#license) says MIT. This does not audit Go/container licenses or substitute for legal review. The Kaordo repository itself has no `LICENSE` (E9). |

## All characteristics and subcharacteristics

| Characteristic | Score |
| --- | ---: |
| Functional suitability | **38.3** |
| Performance efficiency | **24.3** |
| Compatibility | **55.0** |
| Interaction capability | **45.5** |
| Reliability | **27.5** |
| Security | **33.2** |
| Maintainability | **58.4** |
| Flexibility | **39.0** |
| Safety | **32.8** |
| **Quality Score, mean of nine** | **39.3** |

| Characteristic / subcharacteristic | 0–100 | Evidence-based basis |
| --- | ---: | --- |
| **Functional suitability** | **38.3** | Mean of three rows. |
| Functional completeness | 25 | Account journey exists; chat, feed, calls, files and admin journeys are absent (E1, E6). |
| Functional correctness | 55 | Auth/API/config tests pass; no live Keycloak/Postgres or product journey test (E2–E5). |
| Functional appropriateness | 35 | Account gates and links help enter modules, but no communication/storage task completes (E1, E11). |
| **Performance efficiency** | **24.3** | Mean of three rows. |
| Time behaviour | 30 | No measured login, startup, DB, transfer or RTC latency; build size cannot substitute (E2). |
| Resource utilization | 38 | Pre-rendering bounds current static work; no client, DB or identity-server CPU/memory measurement (E2, E5). |
| Capacity | 5 | No representative users/data/concurrency, targets or load tests (E6, E9). |
| **Compatibility** | **55.0** | Mean of two rows. |
| Co-existence | 65 | Five apps build under disjoint routes; simultaneous service deployment unverified (E1, E2, E5). |
| Interoperability | 45 | OIDC/OpenAPI identity contracts are tested; Matrix, tus, LiveKit and Tunnel are not integrated (E4, E6). |
| **Interaction capability** | **45.5** | Mean of eight rows. |
| Appropriateness recognizability | 65 | Pages label product areas and account purpose but show placeholders (E1, E11). |
| Learnability | 50 | Entry steps are described in code; no observed completed user task (E2, E11). |
| Operability | 52 | Sign-in/register/retry/sign-out controls exist; no domain controls or live UI proof (E4, E11). |
| User error protection | 42 | Configured password/profile validation and bounded retry; no live form or account-recovery validation (E4, E5). |
| User engagement | 35 | Rhea styling/status states exist; no real product task or user feedback evidence (E10, E11). |
| Inclusivity | 28 | Some semantic labels/status roles; no keyboard, screen-reader, contrast or focus test (E9–E11). |
| User assistance | 30 | Login guidance, local docs and retry text; no lost-TOTP path or product-task help (E5, E11). |
| Self-descriptiveness | 62 | Pages identify modules, session states and unavailable services (E1, E11). |
| **Reliability** | **27.5** | Mean of four rows. |
| Faultlessness | 55 | Build/type/unit/vet pass; DB, Nodo and live login untested (E2, E3, E5). |
| Availability | 25 | Local health checks exist; no uptime target, monitoring or public deployment (E4, E5, E9). |
| Fault tolerance | 25 | One token refresh and manual retry; service/network/disk failures untested (E4, E6, E11). |
| Recoverability | 5 | Volumes exist; independent backup, restore and authenticator recovery do not (E5, E9). |
| **Security** | **33.2** | Mean of six rows. |
| Confidentiality | 38 | Bearer-protected identity, loopback dev binding and in-memory tokens; no content encryption or public TLS configuration (E4–E6). |
| Integrity | 42 | Signed tokens, SQL parameters and schema constraints; no payload integrity/reconciliation proof (E3–E6). |
| Non-repudiation | 5 | No signed event receipts or durable sensitive-action evidence (E6, E9). |
| Accountability | 22 | Stable subject-to-UUID account mapping; no admin or action audit trail (E4, E5, E9). |
| Authenticity | 62 | PKCE/TOTP config and JWT signature/issuer/audience tests; no live MFA proof and existing-realm policy drift (E4, E5). |
| Resistance | 30 | Brute-force flag, origin allowlist, bearer rejection; no public abuse/rate/quota tests or Nodo admission (E4–E6). |
| **Maintainability** | **58.4** | Mean of five rows. |
| Modularity | 70 | Independent apps, packages and Go services; many reserved boundaries still empty (E1, E6, E7). |
| Reusability | 62 | Shared account/UI/API contracts actually used; domain libraries mostly declarations (E4, E7, E10). |
| Analysability | 55 | Small tree, docs, generator and focused tests; no telemetry, CI history or DB integration (E2–E4, E9). |
| Modifiability | 60 | Clear boundaries; unused dependencies and thin product regression tests raise change risk (E1, E7, E9). |
| Testability | 45 | HTTP/OIDC seams tested; DB, Nodo, live auth, component behavior, accessibility and load are not (E2, E3, E9). |
| **Flexibility** | **39.0** | Mean of four rows. |
| Adaptability | 58 | App/service/environment boundaries exist; only one local topology is described (E1, E5, E6). |
| Scalability | 15 | No feed/chat/file scaling implementation or measured capacity (E1, E6, E9). |
| Installability | 48 | `pnpm dev` can orchestrate a local stack and builds pass; no Docker or production install proof here (E2, E5, E9). |
| Replaceability | 35 | Contracts exist; no provider migration, export/import or replacement test (E4, E6, E7). |
| **Safety** | **32.8** | Mean of five rows; evidence rating, not a claim of safety-critical use. |
| Operational constraint | 32 | Loopback dev binding and identity checks; no public storage/admin limits (E4–E6). |
| Risk identification | 35 | Docs acknowledge local-only/media/backup gaps; no structured hazard or abuse register (E5, E6, E9). |
| Fail safe | 40 | Kerno rejects invalid bearer/origin; Nodo unmounted, but its handler lacks guards if exposed (E4, E6). |
| Hazard warning | 32 | UI/docs mark failures and unavailable features; no incident or lost-TOTP response path (E1, E5, E11). |
| Safe integration | 25 | Identity contract unit tests exist; production ingress, storage and RTC lack integrated validation (E4–E6, E9). |

## Findings

High means a **release blocker for the intended product**, not a claim that an unmounted scaffold can currently be exploited. No Critical issue was demonstrated by this source-and-test audit.

| ID | Severity | Finding / evidence needed to close |
| --- | --- | --- |
| Q-01 | **High** | Core Ligo/Fluo/Rondo/Nodo/Regado tasks absent (E1, E6). Implement representative positive/negative end-to-end journeys. |
| Q-02 | **High** | Account databases have no independent backup, verified restore or lost-TOTP recovery (E5, E9). Require a documented recovery path and timed restore test before real user data is entrusted. |
| Q-03 | **High** | TOTP/password policy is import-only; `syncKeycloak` does not reconcile an existing realm (E5). Require an idempotent policy migration and effective-state test for persisted realms. |
| Q-04 | **High** | No safe public local-server ingress: only loopback `start-dev`, no production Tunnel/TLS, RTC/TURN or reachability proof (E5, E6). Validate a production-like deployment. |
| Q-05 | **High** | tusd handler has no authentication, ownership or quota admission (E6). It remains unmounted; add and test these guards before exposure. |
| Q-06 | Medium | No live stack, browser accessibility, failure/load or CI evidence (E2, E3, E9). Automated representative checks are required for high scores. |
| Q-07 | Medium | **42/74** direct runtime declarations have no direct source reference (E7). Align declarations with actual callers as each module is implemented. |
| Q-08 | Medium | `AccountGate.refresh()` can retain an old `user` after a failed later refresh (E11). Clear stale account state and add a regression test before it guards private content. |
| Q-09 | Medium | No CI, container-image vulnerability/digest control, product license or operations telemetry (E8, E9, E12). npm license metadata alone does not establish full ecosystem licensing. |
| Q-10 | Low | Transitive `cookie@0.6.0` advisory (E8). Track an upstream compatible fix. |

## Third-party implementation and duplicate-work check

The direct dependency inventory searches each declaring package's `src/` for its dependency names, including CSS imports. Transitive use through another workspace package is not counted as direct use. A declaration alone is never credited as an implemented feature.

The installed npm license inventory contains MIT, Apache-2.0, BSD-3-Clause, ISC, MPL-2.0, OFL-1.1 and other reported free/open-source license identifiers; one package needs the upstream README to resolve absent machine-readable metadata (E12). Container images and Go transitive packages were not licensed individually in this audit, so a claim that **every** eventual service is unrestricted and free is not evidenced.

| Workspace package | Direct runtime declarations | Source-referenced | Unused examples |
| --- | ---: | ---: | --- |
| `apps/fluo` | 16 | 3 | TanStack, Tiptap, Uppy, Pica, PhotoSwipe, Video.js, indirect shared packages. |
| `apps/ligo` | 14 | 3 | Matrix, TanStack, Uppy, PhotoSwipe, Video.js, indirect shared packages. |
| `apps/portal` | 6 | 5 | `@kaordo/crypto`. |
| `apps/regado` | 8 | 3 | TanStack and indirect shared packages. |
| `apps/rondo` | 12 | 3 | LiveKit, Matrix, TanStack, Uppy, indirect shared packages. |
| `packages/account-ui` | 4 | 4 | None. |
| `packages/api-client` | 3 | 3 | None. |
| `packages/auth` | 1 | 1 | None. |
| `packages/contracts` | 0 | 0 | OpenAPI generator is a development dependency. |
| `packages/crypto` | 1 | 0 | libsodium. |
| `packages/links` | 1 | 0 | `uuid`. |
| `packages/ui` | 8 | 7 | `@internationalized/date`. |
| **Total** | **74** | **32** | **42 without direct source reference.** |

| Technology | Actual use and correct-use limit |
| --- | --- |
| STaSBLR | SvelteKit/Tailwind build; Rhea configured; generated shadcn-svelte Button/Input/Dialog, Bits UI, Lucide and Inter imported. Button/icons are used. No application Input/Dialog interaction or accessibility test. |
| Keycloak, OIDC, OpenAPI | `keycloak-js`, `go-oidc`, `chi`, `pgx`, `openapi-fetch` and generated types are invoked; focused tests pass. Keycloak owns password/TOTP rather than a custom implementation. Live Keycloak/Postgres and persisted-policy behavior remain unverified. |
| tusd/Uppy | tusd only constructs an unmounted local handler; Uppy has no import. Protected resumable transfer is not implemented. Wire auth/quota/cleanup around tusd before mounting; avoid a parallel custom protocol. |
| Matrix, LiveKit, TanStack, Tiptap, Pica, PhotoSwipe, Video.js | Declared only; no source imports, integrated service or homemade substitute. Do not credit these as working features. |
| libsodium/UUID | Both browser declarations are unused. PostgreSQL generates account UUIDv7 IDs; private-content encryption does not exist. |

The baseline checks supported a narrow authentication-code baseline. The follow-up below establishes a live local account journey, while the intended communication/storage suite remains unimplemented.

## Post-fix evidence for the existing account slice

Changes were verified on 2026-09-29 in the working tree after `7e993d8`. These results do not retroactively change the baseline scores in the tables above.

| Evidence | Result |
| --- | --- |
| `pnpm test:auth` | **30/30** focused tests pass, including shared account resolution, stale account state, concurrent refresh, Keycloak policy reconciliation, audience/claim checks, registration fields, API retry, and presentation-only account preview storage/expiry/clear behavior. |
| `pnpm test:backup` | **4/4** tests pass, including incomplete-pair rejection, latest-complete-run selection, and refusal to store a repository or key inside the source tree. |
| `pnpm test:dev` and a live duplicate-launch check | **3/3** tests pass: free/occupied loopback port detection, a second `pnpm dev` failing before Docker or the ready message, and a standalone site reporting port conflict without an uncaught exception. A normal `pnpm dev` then reached ready, while a simultaneous second launch exited with status 1 and a specific occupied-port message. The test server was stopped afterward. |
| `pnpm test:auth:live` with local Compose, Kerno and headless Chrome | **1/1** integrated journey passes: Username/Password registration, TOTP setup, recovery-code setup, Kerno UUIDv7 account, authenticated `GET /v1/me`, 401 without bearer, 403 from an untrusted origin, signed-in refresh without guest-action flash, sign-out, recovery-code login, normal TOTP login, SSO across Ligo/Fluo/Rondo/Regado, and rejection of a reused recovery code. The journey holds Kerno's session response to verify the cached account preview remains visible during portal reload and module navigation, confirms preview storage contains no token, checks sign-out clears it, and returns Kerno 503 to verify preview and account-gated content disappear. API responses have `no-store` and allowed-origin headers. A local run of 32 concurrent authenticated account lookups had **8 ms p95**; this is not a representative capacity result. axe-core reports **zero automatically detectable WCAG A/AA violations** in the tested entry, registration, TOTP, recovery, portal, and app-gate states. Tab focus and Enter activation were verified for registration entry and submit. The unique test identity and Kerno row are deleted afterward. |
| `pnpm auth:configure` twice on a persisted realm | Both runs succeed. A controlled change to `failureFactor` was then repaired and verified by the sync command without replacing users. |
| `pnpm test:backup:live` with restic 0.19.1 and PostgreSQL 18 | **1/1** isolated repository test passes: direct encrypted dumps of the app and Keycloak databases, full repository data check, restore into temporary databases, table/realm verification, subject reconciliation, and cleanup. No external repository or recurring schedule was configured. |
| `pnpm check:front`, `pnpm test:pages`, Go test/vet/build | Six Svelte projects: **0 errors/0 warnings**; static artifact tests **4/4**, including the silent SSO callback artifact; Go checks pass. |
| `.github/workflows/checks.yml` | A least-privilege push/PR workflow now runs the frontend checks, regenerated API-contract diff, fast account/backup and Pages tests, Go test/vet/build, and an npm Moderate-or-worse advisory gate. `actionlint` accepted the workflow; every workflow command passed locally. No hosted CI run is claimed yet. |
| `pnpm audit --audit-level=low` | One known **Low** transitive `cookie@0.6.0` advisory remains through SvelteKit; no Moderate/High/Critical npm advisory reported. The [upstream SvelteKit issue](https://github.com/sveltejs/kit/issues/13399) notes a breaking dependency upgrade. The current product artifacts are static, and Kaordo does not supply an untrusted cookie name/path/domain to this library; replacing a transitive version outside SvelteKit's declared range would need separate compatibility proof. |

Q-03 (persisted realm policy) and Q-08 (stale account state) are closed by implementation and tests. The portal and app gates now use the same account-session resolver from `packages/account-ui`, so auth/API bootstrap has one implementation. Q-02 is mitigated by built-in one-time recovery codes and tested encrypted backup/disposable-restore commands, but an independent destination, schedule, password copy and actual recovery drill are still unconfigured. Q-06 and Q-09 have new automated evidence, but the first hosted CI run, image/security checks and production telemetry remain outstanding. Q-01, Q-04 and Q-05 concern planned modules and public deployment, so they remain open for the complete product. Automated WCAG and a narrow keyboard path now pass, while complete keyboard/screen-reader testing, representative capacity/load, cross-browser behavior and operational availability have no passing evidence. A **100/100 score for the existing account slice is not supportable** from these checks, and the full Kaordo product still fails the original ≥98/≥95/zero-High gates.
