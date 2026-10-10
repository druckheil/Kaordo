# CI

`.github/workflows/checks.yml` runs on pushes to `main` and `scope-*`, on pull requests and on manual dispatch. A new commit cancels the older run for the same ref. The workflow never deploys. Branch protection should require the final `checks` job. That job passes only when every layer below succeeded; a skipped or cancelled layer fails it.

## Layers

| Job                            | Runs                                                                                                                                                         | Needs              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Frontend and unit tests        | `check:front`, generated-contract diff, `format:check`, `lint`, `knip`, `test:unit`                                                                          | —                  |
| Static app artifact            | `test:pages`: builds every app once and uploads the artifact                                                                                                 | —                  |
| Browser fixtures (3 shards)    | `test:ui`: Playwright scenarios with synthetic data, accessibility and layout checks                                                                         | frontend, artifact |
| Go services and PostgreSQL     | Go build/vet/race tests, `golangci-lint`, regado-agent host tests on loop devices (`test:host`), actionlint, `product-db.integration.mjs` on a disposable DB | —                  |
| Identity, product and recovery | `test:integration`: real Keycloak, Kerno, Nodo, LiveKit and restic against the built artifact                                                                | frontend, artifact |
| Dependency advisories          | `pnpm audit` and `govulncheck` per Go module                                                                                                                 | —                  |

Browser and integration jobs use the **same run's** static artifact, built with local endpoints. Production-origin checks run only in `pnpm test:pages:production` and the deployment preflight.

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

The latest complete hosted run is [release 0.0.3 on main](https://github.com/druckheil/Kaordo/actions/runs/37694725134) at `a739666`. It passed all eight jobs in 6m46s with warm dependency caches. The format, lint, knip and golangci-lint steps were added afterwards and have not yet run on hosted runners. Record their first complete run here.

## Optimizer measurements

The Svelte-aware scan was measured on 2026-10-10 on macOS arm64 with Node 24.18.0, Vite 8.3.1 and Svelte 5.57.1. `pnpm test:unit` starts one Node process per app; the cold phase uses an empty optimizer cache, and the warm phase recreates the Vite server in that same process and verifies that all prepared dependencies were loaded from the cache. Timings include configuration and dependency preparation, exclude process startup and browser rendering, and are diagnostics rather than performance assertions.

| App    | Empty cache | Cached server restart |
| ------ | ----------- | --------------------- |
| Portal | 1,187 ms    | 24 ms                 |
| Fluo   | 1,293 ms    | 31 ms                 |
| Ligo   | 1,247 ms    | 35 ms                 |
| Rondo  | 1,335 ms    | 36 ms                 |
| Regado | 1,222 ms    | 24 ms                 |
| Lingvo | 1,227 ms    | 33 ms                 |
| Memoro | 1,275 ms    | 41 ms                 |

The complete browser suite passed locally as three independent cold fixture shards: 23 tests in 1.3m, 23 in 1.9m and 22 in 1.5m, with zero retries and no optimizer-triggered reloads. These macOS timings do not predict hosted Ubuntu job durations.
