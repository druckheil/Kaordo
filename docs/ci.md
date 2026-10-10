# CI

`.github/workflows/checks.yml` runs on pushes to `main` and `scope-*`, on pull requests and on manual dispatch. A new commit cancels the older run for the same ref. Branch protection requires the final `checks` job. That job passes only when every layer below succeeded; a skipped or cancelled layer fails it. `scope-*` runs validate only. On a push to `main`, a final job asks production to install the release that run built.

## Layers

| Job                            | Runs                                                                                                                                                         | Needs              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Frontend and unit tests        | `check:front`, generated-contract diff, `format:check`, `lint`, `knip`, `test:unit`                                                                          | —                  |
| Static app artifact            | `test:pages`: builds every app once and uploads the artifact                                                                                                 | —                  |
| Production release payload     | Production-origin frontend checks, Linux backend build and complete release-manifest verification; kept as the `production-release` artifact on `main`       | —                  |
| Browser fixtures (3 shards)    | `test:ui`: Playwright scenarios with synthetic data, accessibility and layout checks                                                                         | frontend, artifact |
| Go services and PostgreSQL     | Go build/vet/race tests, `golangci-lint`, regado-agent host tests on loop devices (`test:host`), actionlint, `product-db.integration.mjs` on a disposable DB | —                  |
| Identity, product and recovery | `test:integration`: real Keycloak, Kerno, Nodo, LiveKit and restic against the built artifact                                                                | frontend, artifact |
| Dependency advisories          | `pnpm audit` and `govulncheck` per Go module                                                                                                                 | —                  |

Browser and integration jobs use the **same run's** static artifact, built with local endpoints. The separate production payload job uses public production endpoints and the same packaging path as `pnpm deploy:production`. It never receives production secrets.

## Automatic deployment

GitHub builds; the server only installs. After `checks` passes on a push to `main`, the `deploy` job, the only one allowed to mint an OIDC token, sends that token to `https://kaordo.link/v1/deployments`. Kerno accepts it only when GitHub signed it for that origin and its `workflow_ref` is the one `cd.nix` names, then asks regado-agent to start `kaordo-deploy@<run>`. The job polls the run's state and fails when the deployment fails, so the `production` environment in GitHub shows each result.

The unit downloads the run's `production-release` artifact with a read-only token and installs it with `deploy-release.sh` only if the run is that workflow's push to `main`, passed `checks`, is still the branch head, contains the revision production runs, and its download and archive match GitHub's digest and the clean manifest. Deployments queue behind each other; an older run ends `superseded`. A rejected release leaves the previous one running; re-running the deploy job retries it. Regado alerts on a failed deployment, critically when the rollback failed too. See [production](../deploy/nixos/README.md).

Main protection requires an up-to-date PR and the `checks` context, applies to administrators, and disallows force pushes and deletion; squash and rebase merging are disabled. A merge into `main` is deployment authorization; version tags and release notes remain separate operations.

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
