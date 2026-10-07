# GitHub Actions checks

The `Checks` workflow validates source, static apps, services, product journeys and dependencies. It never deploys. The final `checks` job is the stable status to require in branch protection: every preceding job must succeed, including integration. A failed, skipped or cancelled layer cannot produce a green gate.

## Layers and ownership

| Job | Coverage | Dependencies |
| --- | --- | --- |
| Frontend and unit tests | Svelte/TypeScript, generated OpenAPI types, account/API helpers, layout, dependency ownership and deployment/rollback fixtures | None |
| Static app artifact | All six app builds, prerendered routes, local assets, lazy-loading and initial JavaScript budget | None |
| Browser fixtures and accessibility | Post navigation/composing/sharing, media paste and cold first uploads in Fluo/Ligo/Rondo, native scrolling, Lingvo practice/forms/error recovery, Regado interactions/history, public reflow, touch targets, enlarged text, forced colors, palette contrast and automated WCAG checks | Frontend and static artifact |
| Go services and PostgreSQL | All four modules with race detection, vet and build; isolated product/access tests, capacity fixtures and migration replay | None |
| Identity, product and recovery journeys | Real registration, TOTP/recovery, persistent/rotating/revoked sessions, application SSO, uploads and processing, posts, messaging, LiveKit camera/calls, Lingvo dictionary/card/review/undo persistence, encrypted backup and disposable restore | Frontend and static artifact |
| Dependency advisories | npm advisories and `govulncheck` for every Go module | None |

Static apps are built once and passed to both browser and integration jobs as the **same run's artifact**. The artifact uses explicit local endpoints; tests do not contact production. Release-only production-origin checks remain in `pnpm test:pages:production` and the production deployment preflight.

Push checks run on `main` and `scope-*` branches. Feature branches are checked through pull requests. Tags do not repeat branch checks. `workflow_dispatch` supports explicit runs once the workflow is on the default branch. A new commit cancels obsolete work for the same branch or PR, while unrelated branches remain independent.

## Local reproduction

```sh
pnpm install --frozen-lockfile
pnpm check:front
pnpm test:unit
pnpm test:pages
pnpm exec playwright install chromium --only-shell
pnpm test:ui
pnpm test:product:db # application PostgreSQL running
pnpm test:integration # Docker, ffmpeg and restic installed; app/backend ports free
```

On Linux, install browser system libraries with `pnpm exec playwright install --with-deps chromium --only-shell`. The Playwright version is pinned in `package.json`; use its downloaded Chromium on CI. `CHROME_BIN` and macOS Chrome remain available for local work.

`pnpm test:integration` uses Playwright's `webServer` lifecycle to run `dev-local.mjs --static`. Readiness occurs after the databases, identity policy, Kerno and Nodo are ready and the built site is listening. A process exit fails startup immediately, and startup has a finite deadline. Playwright terminates application processes on exit; CI also stops Compose and deletes its disposable volumes. This local command preserves Docker volumes. `pnpm dev` remains the HMR development workflow.

For an already-running local stack, use `pnpm test:auth:live` or `pnpm test:backup:live`. The identity-only command is a diagnostic subset; CI must always execute the complete live project.

Useful focused commands:

```sh
pnpm test:product:ui
pnpm test:regado:ui
pnpm exec playwright test --project=browser ui-public.test.mjs
pnpm exec playwright test --project=browser ui-quality.test.mjs
pnpm exec playwright install webkit firefox
pnpm test:ui:browsers
pnpm exec playwright test --project=browser --repeat-each=3 --workers=1
pnpm exec playwright show-trace path/to/trace.zip
pnpm exec playwright show-report dist/test-results/report
# Workflow syntax, expressions, action inputs and shell validation
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/checks.yml
```

The PostgreSQL runner defaults to local Compose. CI selects its service container using `KAORDO_TEST_DB_CONTAINER` and passes the disposable password through `KAORDO_DB_PASSWORD`. Each run creates and drops a random database; test data never shares the application database.

`ui-quality.test.mjs` owns representative authenticated UI checks with synthetic data from `ui-quality-fixture.mjs`. It covers 320px/390px/1440px layouts, modal bounds, 24px minimum targets, 44px primary touch targets, keyboard focus/recovery, 200% text size, WCAG text spacing, forced colors and 280 semantic contrast pairs. Screenshots are optional (`KAORDO_UI_SCREENSHOTS=1`) and remain build output. Run static builds and Svelte checks before fixture tests: changing generated `.svelte-kit` files during a Vite scenario can reload the document and invalidate interaction state. Do not interpret a passing axe scan as formal WCAG certification or a measured UEQ/VisAWI score.

`pnpm test:ui:browsers` repeats the synthetic scenarios in WebKit and Firefox with one worker. Chromium owns touch emulation and forced-color scenarios. WebKit remains headless; Firefox's two native PNG clipboard scenarios use a headed browser because this macOS headless backend exposes an image item whose `getAsFile()` is null. The other Firefox scenarios remain headless. On Linux, provide a display with `xvfb-run -a pnpm test:ui:browsers`. This optional engine audit does not change the required Chromium CI gate or launch identity services. The static guest fixture shares the built endpoints' localhost host and resolves silent login with an HTTP redirect. WebKit's route backend cannot fulfill redirects, so that backend uses an equivalent document navigation; real identity redirects stay covered by the live suite.

## Rules for adding and repairing tests

1. **Preserve coverage.** Fix the cause before changing assertions. Do not obtain a green run by excluding a journey, weakening accessibility/access checks, accepting skips or adding blanket retries. Playwright retries are zero and CI rejects `.only`.
2. **Choose the smallest useful layer.** Pure transformations, cancellation and configuration belong in Node unit tests. SQL constraints, transactions and permissions belong in isolated database tests. Rendered behavior belongs in Playwright fixtures. Real identity/media/call/restore boundaries belong in live journeys. `ci-config.test.mjs` rejects unassigned regression files. Add new files to the corresponding suite, not a second full-stack workflow.
3. **Use the real release behavior for integration.** Built static apps avoid Vite dependency discovery and HMR reloads during a lazy editor, upload or call. Fixture Vite servers are worker-owned; every server owns a temporary dependency cache that is removed on teardown, and every test receives a fresh Playwright browser context and its own mocked API state. First-upload regressions explicitly replace the worker's app server with a fresh one so a warm dependency cache cannot hide a reload; never keep two fixture servers generating the same app's `.svelte-kit` source. Synthetic binary uploads use an owned HTTP fixture and verify received bytes because WebKit's route interception cannot expose Blob request bodies. Prepare lazy libraries through their owning workspace package rather than prebundling a second copy of in-memory authentication. Never cache browser storage or share mutable account fixtures.
4. **Wait for observable state.** Prefer role/label locators, Playwright assertions and explicit API actions. Register response listeners before clicking; assert the mutation status and the resulting UI separately. A feed refetch is not the contract for successful posting. Layout checks wait for the requested viewport/state, and accessibility checks start from a deliberately positioned, settled screen.
5. **Keep timeouts intentional.** Normal actions are bounded at 10 seconds, navigation at 15 seconds, and slow processing/startup gets a named budget. Fixed waits are allowed only when measuring actual time semantics, such as an expiry crossing or TOTP period; explain them. Increasing timeouts is not a fix for a missing request or lost dialog.
6. **Own teardown.** Stop fixture servers and background requests, close contexts, remove temporary accounts in `finally`, drop temporary databases and isolate backup repositories. Parallelize independent jobs; keep the live suite sequential because it deliberately exercises shared services and recovery.
7. **Cache inputs, not decisions.** pnpm caches dependency downloads with a frozen lockfile; setup-go caches modules and compilation for the declared toolchain and all four `go.sum` files. Never cache pass/fail results, built apps across revisions, credentials, databases or media. Browser downloads are installed with the pinned Playwright CLI; Linux system packages still need installation, so there is no separate browser cache to maintain.
8. **Make failures diagnosable.** Fixture/public failures retain Playwright traces, screenshots, Vite logs and an HTML report for three days. Inspect the first failed action and application/server output before changing code. Live authentication disables traces and screenshots because requests and native forms contain credentials, tokens and recovery codes; do not upload its storage, dumps, media or environment files.
9. **Keep automation reproducible.** Use the pinned Ubuntu family, Node 24, `go.work`, the lockfile, pinned service/tool versions and commit-pinned Actions. Dependabot groups Action updates monthly. Keep `contents: read`, disable persisted checkout credentials, and preserve the aggregate gate. Lint workflow changes with actionlint and observe the complete hosted run before calling a CI repair verified.
10. **Measure honestly.** Report the commit, run URL, job durations and whether caches were warm. Include startup/setup/artifact time in wall-clock comparisons. A faster run with reduced coverage is not an improvement.

## Investigation evidence

On 6 October 2026 the preceding workflow ran every layer sequentially. The successful [scope-0.0.3 run](https://github.com/druckheil/Kaordo/actions/runs/37420463620) took 7m48s; its Go stage took 2m04s, UI stage 1m02s and live stage 1m26s. Twenty preceding runs failed during browser checks or the live journey. The [last failed live run](https://github.com/druckheil/Kaordo/actions/runs/37418387771) spent 10m07s before failing while waiting 60 seconds for a feed response after publication. The following successful workflow excluded the registration/product journey with `test:auth:live:identity`.

This repair restores that journey, runs it against the single built artifact, observes the publish mutation directly, separates independent jobs and adds native Playwright isolation, diagnostics and workflow validation. Hosted verification results are recorded after execution; local success alone is not evidence of GitHub runner behavior.

### Hosted verification of this repair

Commit `33ae7cfb0a7f79e1fef0b77fdce3549a6ca0e019` passed **all seven jobs twice** on GitHub-hosted Ubuntu 24.04:

| Run | Wall time including setup, artifacts and the aggregate gate | Result |
| --- | --- | --- |
| [Attempt 1](https://github.com/druckheil/Kaordo/actions/runs/37440480234/attempts/1) | 5m14s | All layers passed |
| [Attempt 2, same commit](https://github.com/druckheil/Kaordo/actions/runs/37440480234/attempts/2) | 4m40s | All layers passed |

Each attempt ran 124 Node unit/config/deployment tests and 9 artifact checks with zero skips, 12 browser scenarios, all 5 live journeys, PostgreSQL product/capacity/migration tests, Go race/vet/build, actionlint and both dependency scans. Both restored pnpm/Go dependency caches; browser libraries and Compose services were installed on fresh runners. These measurements are **not a fully cold cache benchmark**. The prior 7m48s baseline had a cold Go cache and excluded the full live registration/product journey, so the timings also reflect different coverage and cache state.

The follow-up tightens cleanup ordering: browser contexts close before temporary identities/application rows are removed, preventing background requests from racing account deletion. It retains the same coverage and budgets.

Reference documentation: [Playwright testing practices](https://playwright.dev/docs/best-practices), [Playwright CI and worker guidance](https://playwright.dev/docs/ci), [Playwright webServer lifecycle](https://playwright.dev/docs/test-webserver), [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
