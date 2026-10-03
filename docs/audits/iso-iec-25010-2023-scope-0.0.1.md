# ISO/IEC 25010:2023 product quality audit — Kaordo 0.0.1

> Historical assessment of the tree and scope at the stated date. Scores, paths and deployment gaps describe that assessment, not the current refactored tree. See [the 3 October 2026 refactor review](../refactoring.md) and [current architecture](../architecture.md) for updated ownership, capabilities and verification.

**Date:** 2026-09-29

**Baseline:** `146b0e5` on `scope-0.0.1`, plus the two Pages artifact tests added with this audit.

**Decision:** **Not release ready.** Quality Score **25.0/100**; lowest category **5.0/100**; **0 Critical, 4 High** release blockers. The requested gates (overall ≥98, every category ≥95, no Critical/High findings) are **not met**.

This is an engineering assessment of the *intended Kaordo product as implemented today*, not a certification. ISO/IEC 25010:2023 defines nine product quality characteristics and their subcharacteristics; it does not prescribe this 0–100 formula or a 98-point pass mark. The score and gates are local to this audit. Terminology follows the [ISO standard listing](https://www.iso.org/standard/78176.html) and the [ISO/IEC 25010:2023 preview](https://cdn.standards.iteh.ai/samples/78176/13ff8ea97048443f99318920757df124/ISO-IEC-25010-2023.pdf). The 2023 names **interaction capability**, **flexibility**, **faultlessness**, **resistance**, and **safety** are used rather than the older 2011 model.

## Method and evidence boundary

Each subcharacteristic is rated 0–100 against the stated product scope, using these anchors: **0–20** absent or only planned; **21–45** static scaffold or partial implementation with no representative runtime proof; **46–70** working boundary or flow with limited validation; **71–94** integrated implementation with automated, representative tests; **95–100** explicit acceptance targets met in representative production-like, failure, security, accessibility, and load conditions. Values between anchors express the evidence stated in the table, not a claim of statistical precision. A characteristic is the arithmetic mean of its subcharacteristics; the overall score is the arithmetic mean of the nine characteristics. A missing workflow is scored low, never marked “N/A” merely because the scaffold has no users yet.

The following evidence is reproducible on the audited tree. Build output is ignored by Git; this commit contains the report, a documentation link, test source, and an npm script.

| ID | Evidence and result |
| --- | --- |
| E1 | `README.md`, `AGENTS.md`, `docs/architecture.md`: 0.0.1 intentionally contains boundaries and dependency wiring, with product workflows scheduled later. |
| E2 | `apps/{portal,ligo,fluo,rondo,regado}/src/routes/+page.svelte` and `packages/links/src/index.ts`: five labeled static pages and cross-app paths; no feature forms, feeds, chat, calls, or admin controls. |
| E3 | `pnpm check:front`: all six Svelte projects report 0 errors and 0 Svelte warnings. `pnpm test:pages`: five builds and **2/2** Pages artifact tests pass. The tests verify all five routes, the portal/back links, and every local HTML asset reference. `dist/pages` has 95 files and occupies about 2.5 MiB on disk; 44 local HTML references resolve. |
| E4 | `go build ./services/kerno/... ./services/nodo/...` and `go vet ./services/kerno/... ./services/nodo/...` pass. `go test ./services/kerno/... ./services/nodo/...` reports six packages with **no Go test files**. |
| E5 | `services/kerno/cmd/kerno/main.go` and `services/nodo/cmd/nodo/main.go` only log scaffold messages; neither starts a listener. `services/kerno/internal/{httpapi,identity,postgres}` contains wrappers, not an API or access policy. `services/nodo/internal/upload/handler.go` constructs a tusd file handler without authentication, authorization, quotas, or a mounted server. |
| E6 | `packages/{api-client,auth,contracts,crypto}/src/index.ts` exports nothing; `packages/contracts/openapi.yaml` has `paths: {}`. No wire or identity contract is implemented. |
| E7 | Source import inventory against all 64 direct runtime dependency declarations: **17 imported, 47 not imported**. All five apps import `@kaordo/ui` and `@kaordo/links`; `packages/ui` imports 7 of its 8 direct runtime dependencies. Planned functionality libraries have no callers. Declarations alone are not credited as implementations. |
| E8 | `pnpm audit --audit-level=low` and `pnpm audit --prod --audit-level=low`: one **Low** advisory, `cookie@0.6.0` via SvelteKit, [GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x); no reported Moderate/High/Critical npm advisory. `govulncheck ./...` in each Go module: “No vulnerabilities found.” These are known-advisory scans, not proof that the code is secure. |
| E9 | `pnpm licenses list --json`: 231 installed package records; 230 have recognized license metadata, one (`combine-errors@3.0.3`, through `@uppy/tus`) is “Unknown” in package metadata but its [upstream README](https://github.com/matthewmueller/combine-errors#license) states MIT. `go-licenses report ./...` covers imported Go libraries: Kerno 11 and Nodo 3 records, all reported MIT, Apache-2.0, or BSD-3-Clause. This is a dependency inventory, not a legal opinion. |
| E10 | `deploy/*/README.md`: infrastructure is reserved only. There is no PostgreSQL, Keycloak, Synapse, LiveKit/TURN, Tunnel, mirrored storage, backup, restore, observability, or release configuration. The LiveKit README explicitly notes that media/TURN reachability needs external network validation. |
| E11 | `git ls-files` finds no committed CI workflow, product integration test, load test, threat model, accessibility audit, recovery exercise, release runbook, or project `LICENSE`. The two Pages tests added here cover only the static artifact. Tracked path names contain no obvious secret or generated build file; file contents were not scanned for secret values. |
| E12 | A local HTTP check returned 200 for `/`, `/ligo/`, `/fluo/`, `/rondo/`, and `/regado/`. This is a route smoke check only. No measured Core Web Vitals, concurrency test, real-device accessibility test, or production telemetry exists. Chrome DevTools performance tracing was unavailable, so no runtime performance number is inferred from bundle size. |

## Scores — all 9 characteristics and 40 subcharacteristics

| Characteristic | Score |
| --- | ---: |
| Functional suitability | **18.3** |
| Performance efficiency | **23.3** |
| Compatibility | **37.5** |
| Interaction capability | **31.9** |
| Reliability | **11.3** |
| Security | **5.0** |
| Maintainability | **47.0** |
| Flexibility | **35.0** |
| Safety | **16.0** |
| **Overall, equal characteristic weights** | **25.0** |

| Characteristic / subcharacteristic | 0–100 | Specific basis |
| --- | ---: | --- |
| **Functional suitability** | **18.3** | Mean of the next three rows. |
| Functional completeness | 10 | Five pages exist, but intended messaging, feed, communities, storage, and admin journeys are absent (E1, E2, E5). |
| Functional correctness | 30 | The static routing and asset contract passes two tests; no domain behaviour is available to check (E2, E3). |
| Functional appropriateness | 15 | Entry links support orientation only; no end-to-end user task exists (E2). |
| **Performance efficiency** | **23.3** | Mean of the next three rows. |
| Time behaviour | 30 | Static build sizes are known; latency, INP, startup, and transfer timings are unmeasured (E3, E12). |
| Resource utilization | 35 | Pre-rendering and small placeholder pages limit current work, while five builds duplicate shared assets; server/RTC resource use is unknown (E3, E10). |
| Capacity | 5 | No running service, realistic dataset, storage load, or concurrency benchmark (E5, E10, E12). |
| **Compatibility** | **37.5** | Mean of the next two rows. |
| Co-existence | 60 | Five independent SvelteKit builds assemble under disjoint paths; no concurrent service deployment is tested (E2, E3, E10). |
| Interoperability | 15 | OpenAPI is empty and identity, Matrix, LiveKit, and tus flows have no verified contracts (E5, E6, E10). |
| **Interaction capability** | **31.9** | Mean of the next eight rows. |
| Appropriateness recognizability | 60 | Named modules, descriptions, heading, and links identify the static sections (E2, E3). |
| Learnability | 40 | Simple entry/back paths are understandable; no actual task has been evaluated with users (E2, E12). |
| Operability | 45 | Static navigation is tested; composing, posting, calling, and administration have no controls (E2, E3). |
| User error protection | 5 | No workflow validation, confirmation, undo, or error handling can be exercised (E2, E5). |
| User engagement | 25 | Shared Rhea styling exists; no product interaction or research evidence exists (E2, E7). |
| Inclusivity | 20 | Basic semantic headings and links exist, without keyboard, screen-reader, contrast, or diverse-user validation (E2, E11). |
| User assistance | 10 | Repository documentation exists, but no in-product guidance for actual tasks (E1, E2). |
| Self-descriptiveness | 50 | The visible pages explicitly describe themselves as scaffolds, without describing future tasks or system state (E2). |
| **Reliability** | **11.3** | Mean of the next four rows. |
| Faultlessness | 35 | Builds, type checks, static artifact tests, and Go vet pass; no runtime behaviour is tested (E3, E4). |
| Availability | 5 | No service process, uptime objective, health check, or deployed monitoring (E5, E10). |
| Fault tolerance | 5 | No network, disk, identity, or RTC failure paths implemented or exercised (E5, E10). |
| Recoverability | 0 | Backup/restore and mirror behaviour are only planned (E10, E11). |
| **Security** | **5.0** | Mean of the next six rows. |
| Confidentiality | 10 | No private content is served by the scaffold, but neither auth nor encryption boundary is implemented (E5, E6). |
| Integrity | 10 | Lockfiles and build checks exist, but no signed data, storage consistency, or write authorization exists (E3, E5). |
| Non-repudiation | 0 | No signed event or action evidence exists (E5, E6). |
| Accountability | 0 | No authenticated actor or audit trail exists (E5, E6, E10). |
| Authenticity | 5 | OIDC provider wrapper exists; no login, token verification, session, or RBAC path exists (E5, E6). |
| Resistance | 5 | No rate limit, abuse control, quota enforcement, or adversarial test exists (E5, E10, E11). |
| **Maintainability** | **47.0** | Mean of the next five rows. |
| Modularity | 65 | Separate apps, packages, and Go modules have clear directories; interfaces are still mostly empty (E1, E5, E6). |
| Reusability | 50 | Shared UI and route contract are actually reused; most shared packages are empty (E2, E6, E7). |
| Analysability | 50 | Small source tree, architecture notes, reproducible checks, and this evidence record aid diagnosis; no telemetry or CI history exists (E1, E3, E10, E11). |
| Modifiability | 50 | The monorepo boundaries and static builds are simple, but there are no domain contracts or change regression suites (E3, E6, E11). |
| Testability | 20 | Two artifact tests now exist; all Go packages and product flows still lack tests (E3, E4, E11). |
| **Flexibility** | **35.0** | Mean of the next four rows. |
| Adaptability | 55 | Independent app/package and service boundaries support future replacement, without a second platform or configuration proof (E1, E3, E5). |
| Scalability | 10 | No feed, chat, storage, or call load model or benchmark (E5, E10, E12). |
| Installability | 40 | Static Pages and Go sources build locally; reproducible deployment and node setup are absent (E3, E4, E10). |
| Replaceability | 35 | Interfaces are reserved for external systems, but no provider swap or data export/import is implemented (E6, E10). |
| **Safety** | **16.0** | Mean of the next five rows; this measures available evidence, not a claim that Kaordo is safety-critical. |
| Operational constraint | 15 | No production operation is active, but storage quotas, administrative restrictions, and abuse boundaries are unimplemented (E5, E10). |
| Risk identification | 25 | Architecture notes mention backup and media reachability constraints; no structured hazard or abuse analysis exists (E1, E10, E11). |
| Fail safe | 10 | Binaries do not open listeners, but a future mount of the current tusd builder would have no admission checks (E5). |
| Hazard warning | 20 | README and UI state “scaffold”; no operational warning/incident workflow exists (E1, E2, E10). |
| Safe integration | 10 | Identity, storage, RTC, and ingress integration has not been configured or verified (E6, E10). |

## Findings and release implications

Severity here means the consequence of **shipping Kaordo as the intended product**; a High release blocker is not an assertion that the inactive scaffold is currently exploitable.

| ID | Severity | Finding | Evidence / required closure |
| --- | --- | --- | --- |
| Q-01 | **High** | Core user workflows are absent. | E1, E2, E5. Implement specified Ligo, Fluo, Rondo, Nodo, identity, and admin journeys, then test them end to end against written acceptance cases. |
| Q-02 | **High** | Private-data access and write boundaries are absent. | E5, E6. Before any listener is exposed, require authenticated identity, authorization, quotas, validation, and negative security tests for every Kerno/Nodo/admin route. The present tusd builder must never be mounted directly on public ingress. |
| Q-03 | **High** | Durability and recovery are only plans. | E5, E10, E11. Implement real mirrored storage, independent backups, reconciliation, and a timed restore exercise before user data is stored. |
| Q-04 | **High** | The proposed local-server ingress is unresolved for media and file paths. | E10. Validate Tunnel routes and WebSocket signalling, actual client-to-Nodo reachability, and LiveKit TURN/media connectivity behind the user's network restrictions. Document tested fallbacks. |
| Q-05 | Medium | No product-level automated regression or CI gate. | E3, E4, E11. Keep the Pages tests; add contract, auth, storage, browser accessibility, service integration, and failure tests as functionality arrives. |
| Q-06 | Medium | 47 of 64 direct runtime declarations are not imported by source. | E7. Treat them as reserved candidates, not implemented capability. Add a library with its first real caller and remove candidates that are rejected; avoid parallel hand-written substitutes. |
| Q-07 | Medium | Performance and scale have no representative measurements. | E3, E12. Define devices, datasets, concurrency, transfer sizes, and latency/capacity targets, then benchmark actual integrated services and Pages output. |
| Q-08 | Low | One known `cookie@0.6.0` advisory remains in the dependency graph. | E8. Track the upstream SvelteKit fix or validate a compatible override; do not suppress the advisory without analysis. |
| Q-09 | Low | One transitive npm package lacks machine-readable license metadata; the repository itself has no `LICENSE`. | E9, E11. Record the upstream MIT evidence and decide Kaordo's own distribution license before publication. |

No Critical issue was demonstrated. The npm and Go known-advisory scanners found no High/Critical dependency advisory at the audit date; that result does **not** close Q-02 or prove the future services secure.

## Third-party use and “do not reinvent” check

Direct runtime dependency declarations were compared with import specifiers in the package's own `src/` files (including CSS imports). This measures current source use, not transitive use or a future integration plan.

| Workspace package | Declared | Source-imported |
| --- | ---: | ---: |
| `apps/fluo` | 15 | 2 |
| `apps/ligo` | 13 | 2 |
| `apps/portal` | 6 | 2 |
| `apps/regado` | 7 | 2 |
| `apps/rondo` | 11 | 2 |
| `packages/api-client` | 1 | 0 |
| `packages/auth` | 1 | 0 |
| `packages/contracts` | 0 | 0 |
| `packages/crypto` | 1 | 0 |
| `packages/links` | 1 | 0 |
| `packages/ui` | 8 | 7 |
| **Total** | **64** | **17** |

| Library group | Declared or imported? | Audit conclusion |
| --- | --- | --- |
| Tailwind, shadcn-svelte Rhea, Bits UI, Lucide | **Imported and built.** `packages/ui/src/lib` has generated Button, Input, Dialog; app pages use Button and icon. | Correct foundational reuse observed for the narrow static UI. Input/Dialog behaviour is not exercised by app workflows. |
| SvelteKit static adapter | **Imported and built** in every app. | Correctly produces five static subpaths in the Pages artifact; the two artifact tests verify local references. |
| `@kaordo/links` | **Imported** by all five apps. | Centralizes the five current paths; no object-link/deep-link contract yet. The `uuid` dependency is unused. |
| TanStack Query / Virtual | Declared, **no source import**. | No fetching, cache, pagination, or virtual list exists. Use the official adapters when these flows are implemented. |
| Matrix JS SDK and planned Synapse | Declared, **no source import**; no Synapse configuration. | No Matrix messaging or encryption can be credited. Design SDK-based flows and identity mapping before any custom protocol. |
| LiveKit client and planned SFU/TURN | Declared, **no source import**; no server configuration. | No voice/video functionality or reachability proof. Use LiveKit for RTC rather than a custom SFU. |
| Uppy Core/Tus and Go tusd | Uppy declared but **not imported**; tusd is called only in an unmounted handler builder. | Resumable transfer is not implemented. Require admission, quotas, completion handling, and tests before exposing tusd. |
| Tiptap, Pica, PhotoSwipe, Video.js | Declared, **no source import**. | No editor, resize, gallery, or player exists; no homemade duplicate exists either. Integrate only where product flows require them. |
| Keycloak JS / go-oidc, openapi-fetch, libsodium | Browser packages **not imported**; Go OIDC has one metadata wrapper; OpenAPI paths empty. | Authentication, generated API client, and private-content encryption are not implemented. Avoid claiming secure messaging from dependency presence. |
| chi, pgx | Thin Go wrappers exist, but no listener, routes, queries, or schema. | Sound candidate packages, with no evidence yet of correct production integration. |

The installed dependency licenses are largely permissive by the recorded tools, but no running deployment of Keycloak, Synapse, LiveKit, Grafana, or other planned server software exists here. Their future versions, licenses, configuration, and operational obligations must be audited when selected. No conclusion about complete ecosystem license compliance can be drawn from the present manifests.

## Path to the requested gate

1. Specify executable acceptance cases for each Kaordo journey and cross-app data contract. Implement and test the real services and clients, including unauthorized and offline cases.
2. Prove security boundaries before any public exposure: identity and role checks, Nodo admission and quota enforcement, key handling, encrypted-content threat model, audit trail, abuse control, and automated negative tests.
3. Deploy a disposable production-like local stack and verify Tunnel and TURN reachability, backup/restore, disk failure, interrupted uploads, session loss, and service restart.
4. Add CI for static checks, Go tests/vet, Pages assembly, dependency/advisory/license inventory, API compatibility, browser accessibility, and representative integration/load tests. Record pass/fail artifacts.
5. Define measurable latency, capacity, availability, accessibility, and recovery targets; collect results against representative data and devices. Re-score every row from new evidence. Only then assert the ≥98 / ≥95 / zero-High gate.

The current score is intentionally low because a successful scaffold build cannot demonstrate the quality of a communication and storage product that does not exist yet.
