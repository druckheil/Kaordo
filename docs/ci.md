# CI

`.github/workflows/checks.yml` runs on pushes to `main` and `scope-*`, on pull requests and on manual dispatch. A new commit cancels the older run for the same ref. Branch protection requires the final `checks` job. That job passes only when every layer below succeeded; a skipped or cancelled layer fails it. `scope-*` runs validate only. Production's independent pull service deploys the current `main` after verifying its successful push run and every validation job. GitHub runners have no server credentials or connection to production data.

## Layers

| Job                            | Runs                                                                                                                                                         | Needs              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Frontend and unit tests        | `check:front`, generated-contract diff, `format:check`, `lint`, `knip`, `test:unit`                                                                          | —                  |
| Static app artifact            | `test:pages`: builds every app once and uploads the artifact                                                                                                 | —                  |
| Production release payload     | Production-origin frontend checks, Linux backend build and complete release-manifest verification; the bundle stays on the disposable runner                 | —                  |
| Browser fixtures (3 shards)    | `test:ui`: Playwright scenarios with synthetic data, accessibility and layout checks                                                                         | frontend, artifact |
| Go services and PostgreSQL     | Go build/vet/race tests, `golangci-lint`, regado-agent host tests on loop devices (`test:host`), actionlint, `product-db.integration.mjs` on a disposable DB | —                  |
| Identity, product and recovery | `test:integration`: real Keycloak, Kerno, Nodo, LiveKit and restic against the built artifact                                                                | frontend, artifact |
| Dependency advisories          | `pnpm audit` and `govulncheck` per Go module                                                                                                                 | —                  |

Browser and integration jobs use the **same run's** static artifact, built with local endpoints. The separate production payload job uses public production endpoints and verifies the same packaging path as the host builder. It never receives production secrets, uploads the production bundle or deploys.

## Automatic deployment

The NixOS `kaordo-cd.timer` checks public `main` once a minute, plus up to ten seconds of jitter. A matching successful `push` run of `checks.yml` must belong to repository ID `1333035875` and workflow ID `370320419`; its current attempt must include every named validation job with a successful conclusion. Pull requests, scope branches, manual-dispatch runs, forks, stale commits, failed/skipped jobs and older successful attempts cannot authorize deployment. An unchanged or waiting revision stays quiet after its first state update.

The host rebuilds that exact clean revision as `kaordo-build`. Each build starts with a fresh checkout, dependency/toolchain workspace and outputs. Its systemd sandbox can write only `/srv/kaordo/cd-build`; production media, databases, runtime sockets, recovery copies, home directories and secrets are inaccessible. Pnpm follows `packageManager` and the lockfile; Go follows the checked-in toolchain and module sums. Existing migrations cannot change, and the candidate must contain the active production revision in its Git history. No dependency installation runs with production privileges.

The controller rechecks `main` and CI after the build and before activation. It verifies the archive checksum and clean manifest, takes a verified encrypted deployment checkpoint, and uses the same host lock as operator deployments. A separate transient activation unit survives newer commits and NixOS changes to the poller. Frontend, binaries, configuration and identity policy roll back on failed post-checks; forward-only database migrations remain. A failed attempt stays stopped until a new successful CI attempt or commit authorizes another try. An interrupted activation fails closed and needs host inspection.

The bootstrap state records the existing `main` and the active production manifest, so installing CD does not deploy an older `main` over a newer scope release. The next merged `main` must include that production history. Main protection requires an up-to-date PR and the GitHub Actions `checks` context, applies to administrators, and disallows force pushes and deletion. Merge commits preserve deployed ancestry; squash and rebase merging are disabled. No additional review approval is required. A merge into protected `main` is deployment authorization; version tags and public release notes remain separate operations. See [production](../deploy/nixos/README.md) for host status and recovery.

While CI is pending, evidence queries are spaced by two minutes. A failed deployment checks for a new successful CI attempt once every ten minutes and never repeats the failed attempt. This bounds unauthenticated GitHub API requests while retaining automatic recovery through a new validated commit or run attempt.

## Local reproduction

```sh
pnpm install --frozen-lockfile
pnpm check:front && pnpm format:check && pnpm lint && pnpm knip
pnpm test:unit
pnpm test:pages
pnpm exec playwright install chromium --only-shell
pnpm test:ui
pnpm lint:go && pnpm test:go
pnpm test:host        # Docker with privileged containers
pnpm test:product:db  # application PostgreSQL container running
pnpm test:integration # Docker and restic installed; ports free; pnpm dev stopped
```

`test:integration` starts `dev-local.mjs --static` through Playwright's `webServer` and stops it on exit. CI also removes the Compose volumes. With `pnpm dev` already running, `pnpm test:auth:live` and `pnpm test:backup:live` run the live journeys against it. On one machine, run `test:unit` before `test:integration`, because the launcher tests briefly hold the same ports.

Finish `check:front` and `test:pages` before starting `test:ui`. SvelteKit sync and builds update files watched by fixture Vite servers and can reload an active browser scenario or invalidate optimized dependencies.

All seven apps use `localViteDependencies` in `scripts/local-vite.mjs`. Vite normally scans only Svelte script blocks, losing template imports and functions called only by actions or events. A Rolldown `load` hook supplies the compiled JavaScript for linked Svelte source components, so the scanner follows the complete component graph, including template-level lazy imports. Components in `node_modules` remain owned by the Svelte optimizer plugin. The complete scan can publish prepared bundles without waiting for the browser's static crawl (`holdUntilCrawlEnd: false`). Linked workspace modules stay unbundled so auth and feature state retain one instance. Dependency bundles and static release builds retain their normal tree shaking.

`vite-dependencies.test.mjs` starts every real app in a separate process with an empty temporary cache and asserts that its lazy libraries finish optimization before a browser request. It then restarts with the same cache, verifies reuse of the complete graph and reports measured cold/warm preparation times. `test:unit` runs these scans after the other Node suites so optimizer CPU work does not compete with deployment fixtures that spawn host-command stubs. Browser fixture teardown also rejects dependency-scan errors and optimizer-triggered page reloads, even when the interaction assertions happen to pass. The Playwright worker owns and removes each cache, so every hosted browser shard starts cold regardless of pnpm and Go cache hits.

`test:product:db` creates a random database in the local `app-db` container (CI sets `KAORDO_TEST_DB_CONTAINER` and `KAORDO_DB_PASSWORD`), runs the Kerno PostgreSQL tests with `-race` against it and drops it. The tests apply the embedded migrations and fail when the generated Jet tables differ from the schema. It never touches the application database.

Useful focused runs:

```sh
pnpm test:product:ui
pnpm test:regado:ui
node --test scripts/vite-dependencies.test.mjs
pnpm exec playwright test --project=browser ui-quality.test.mjs
pnpm exec playwright test --project=browser --repeat-each=3 --workers=1
pnpm test:ui:browsers # optional WebKit/Firefox audit
pnpm exec playwright show-trace path/to/trace.zip
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/checks.yml
```

## Rules for tests

1. **Preserve coverage.** Fix the cause, not the assertion. No excluded journeys, accepted skips, `.only` or retries. Playwright retries are zero.
2. **Use the smallest layer that proves the behavior.** Pure logic goes in Node unit tests. Constraints, transactions and access go in PostgreSQL tests. Rendered behavior goes in Playwright fixtures. Real identity, media, calls and restore go in live journeys. `ci-config.test.mjs` rejects test files no suite runs.
3. **Integration uses release behavior.** Built static apps avoid Vite dependency discovery and HMR reloads. Every fixture test gets a fresh browser context and its own mocked API state. Never share mutable accounts or cache browser storage.
4. **Wait for observable state.** Use role and label locators and web-first assertions. Register response listeners before the click. Assert the mutation and the resulting UI separately.
5. **Keep timeouts intentional.** Actions get 10 s and navigation 15 s; slow work gets a named budget. Fixed sleeps are allowed only to measure time itself (for example a TOTP period), with a comment saying so.
6. **Own teardown.** Close contexts before deleting temporary accounts in `finally`. Drop temporary databases and isolate backup repositories.
7. **Cache inputs, not results.** Cache pnpm and Go downloads and builds only. Never cache built apps across revisions, credentials, databases or media.
8. **Keep failures diagnosable and safe.** Fixture failures keep traces, screenshots and the HTML report for three days. Live identity tests disable traces and screenshots because they contain credentials. Never upload environments, tokens, storage, dumps or media.
9. **Keep automation reproducible.** Pin Ubuntu, Node 24, the lockfile, service images, tools and Actions by commit. Keep `contents: read` and checkout without persisted credentials. After dependency changes, also run `GOWORK=off go build`, `go mod verify` and `govulncheck` in each module.
10. **Measure honestly.** Record the commit, run URL, job durations and cache state. A faster run with less coverage is not an improvement.

## Hosted evidence

The complete [Svelte dependency discovery run](https://github.com/druckheil/Kaordo/actions/runs/38052661311) on 2026-10-10 tested `120054e5ef1a0de0bbc6c5463459c24b9b93972d` on `scope-0.0.4`. All nine jobs passed in 7m55s, measured from workflow creation to completion of the final gate. This includes formatting, ESLint, knip, golangci-lint, actionlint, all 198 Node tests, 10 static artifact checks, 68 browser scenarios and all five live journeys. Browser scenarios used zero retries; the optimizer reload guard remained clean.

| Job                                  | Duration |
| ------------------------------------ | -------- |
| Frontend and unit tests              | 2m44s    |
| Static app artifact                  | 1m43s    |
| Browser fixtures and accessibility 1 | 3m55s    |
| Browser fixtures and accessibility 2 | 4m59s    |
| Browser fixtures and accessibility 3 | 4m24s    |
| Go services and PostgreSQL           | 3m36s    |
| Identity, product and recovery       | 4m42s    |
| Dependency advisories                | 42s      |
| Final checks gate                    | 3s       |

Job durations include dependency setup and cleanup. Every pnpm setup restored its package cache through a matching restore key; the Go and golangci-lint caches also hit. Browser installation and each fixture's Vite optimization were fresh. The unit suite measured both empty and reused Vite caches on the hosted runner, as shown below. No hosted run with empty pnpm and Go caches was measured for this change, so the workflow total is a warm dependency-cache result.

### Pull deployment validation

The complete [CD validation run](https://github.com/druckheil/Kaordo/actions/runs/38057803549) on 2026-10-10 tested `28f40ee2583753649b95f2dc7047a7aaaff96ad5` on `scope-0.0.4`. All ten jobs passed in 9m23s from workflow creation to the final gate, including 38 seconds before the first job started. It ran 206 Node tests, 68 browser scenarios with zero retries, all five live journeys, the complete Linux production payload, Go/PostgreSQL/host checks and dependency audits.

| Job                                  | Duration |
| ------------------------------------ | -------- |
| Frontend and unit tests              | 3m24s    |
| Static app artifact                  | 1m16s    |
| Production release payload           | 1m50s    |
| Browser fixtures and accessibility 1 | 2m49s    |
| Browser fixtures and accessibility 2 | 5m13s    |
| Browser fixtures and accessibility 3 | 4m45s    |
| Go services and PostgreSQL           | 4m20s    |
| Identity, product and recovery       | 4m19s    |
| Dependency advisories                | 53s      |
| Final checks gate                    | 3s       |

Pnpm, Go and golangci-lint restored dependency/build caches. Chromium installation and the browser fixtures' Vite caches were fresh. The Node scans independently measured empty and reused optimizer caches; these are preparation times, not page-load measurements:

| App    | Hosted empty optimizer cache | Hosted cached restart |
| ------ | ---------------------------- | --------------------- |
| Portal | 3,568 ms                     | 59 ms                 |
| Fluo   | 3,931 ms                     | 125 ms                |
| Ligo   | 3,720 ms                     | 102 ms                |
| Rondo  | 3,973 ms                     | 90 ms                 |
| Regado | 3,730 ms                     | 57 ms                 |
| Lingvo | 3,803 ms                     | 58 ms                 |
| Memoro | 3,840 ms                     | 103 ms                |

### Production commissioning

On 2026-10-10, the checked CD infrastructure was activated on the existing NixOS host. Bootstrap recorded main `f87e9b3a4937a73360723c6f037115d1fcf3a735` and the active clean application revision `f723454fcd25272be6d8d4c0cf323e0a3f56eaeb`; it preserved the application release and enabled the timer. Every required application service remained active.

A headless probe inside the deployed builder unit confirmed a non-root UID, `NoNewPrivs=1`, private temporary files, denied access to production secrets, media, PostgreSQL, recovery copies and runtime sockets, and denied writes outside its workspace. It checked access decisions without reading production content.

That same unit built a complete clean payload from `28f40ee2583753649b95f2dc7047a7aaaff96ad5` in 9m51s, with empty pnpm and Go caches, 1.1 GiB peak resident memory and 412 MiB peak swap. The test selected the already checked scope revision through a temporary instance override; the production main guard remained unchanged. All seven static applications, three Linux binaries, the archive checksum and manifest passed. The override and probe scripts were removed, and the candidate was not activated.

The installed checkpoint implementation completed a real encrypted capture and disposable restore of both application and Keycloak databases in 2m21s. Services resumed before backup and restore verification; all temporary databases, plaintext staging and read-only media snapshots were removed. The repository remained root-only with mode `0700`, and its password and checkpoint metadata used `0600`. No dump, credential or user file left the host. This verified a local release checkpoint, not an independent server-loss backup. Application activation through a future main push remains a separate deployment event.

## Optimizer measurements

The Svelte-aware scan was measured on 2026-10-10 on macOS arm64 with Node 24.18.0, Vite 8.3.1 and Svelte 5.57.1. `pnpm test:unit` starts one Node process per app; the cold phase uses an empty optimizer cache, and the warm phase recreates the Vite server in that same process and verifies that all prepared dependencies were loaded from the cache. Timings include configuration and dependency preparation, exclude process startup and browser rendering, and are diagnostics rather than performance assertions.

The same test in the hosted run above measured the following on Ubuntu 24.04 x64. Package downloads were cached in both environments; the cold column specifically means an empty Vite optimizer cache.

| App    | Local empty cache | Local cached restart | Hosted empty cache | Hosted cached restart |
| ------ | ----------------- | -------------------- | ------------------ | --------------------- |
| Portal | 1,187 ms          | 24 ms                | 2,580 ms           | 48 ms                 |
| Fluo   | 1,293 ms          | 31 ms                | 2,985 ms           | 61 ms                 |
| Ligo   | 1,247 ms          | 35 ms                | 2,805 ms           | 72 ms                 |
| Rondo  | 1,335 ms          | 36 ms                | 2,914 ms           | 73 ms                 |
| Regado | 1,222 ms          | 24 ms                | 2,857 ms           | 45 ms                 |
| Lingvo | 1,227 ms          | 33 ms                | 2,720 ms           | 44 ms                 |
| Memoro | 1,275 ms          | 41 ms                | 2,823 ms           | 80 ms                 |

The complete browser suite passed locally as three independent cold fixture shards: 23 tests in 1.3m, 23 in 1.9m and 22 in 1.5m, with zero retries and no optimizer-triggered reloads. These macOS timings do not predict hosted Ubuntu job durations.
