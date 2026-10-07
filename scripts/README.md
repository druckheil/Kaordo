# Repository scripts

Run scripts from the repository root through `package.json` where a command exists. Modules are ordinary Node ESM with purpose comments before imports; shell launchers remain for starting individual Go services.

- `dev-local.mjs` orchestrates configuration, Docker services, migrations and Go builds. It serves six Vite servers behind one local origin for HMR; `--static` serves the already-built apps for integration without HMR. `local-vite.mjs` owns their ports and proxy paths. `local-session.mjs` records checkout-owned processes; `stop-local.mjs` stops those processes without killing unrelated port owners.
- `sync-keycloak.mjs` reconciles realm/client/profile policy and validates token mapping. It preserves accounts and keeps admin credentials out of output.
- `build-pages.mjs` assembles independently built apps; `serve-pages.mjs` serves the local combined artifact.
- `deploy-pages.mjs` builds and verifies production frontend assets before uploading a checksummed release; `deploy/nixos/deploy-static.sh` performs preflight, atomic activation and rollback checks on the host.
- `deploy-production.mjs` validates one source snapshot and builds a checksummed frontend/backend/configuration bundle; `deploy/nixos/deploy-release.sh` applies migrations, switches NixOS, verifies public applications and Keycloak policy/theme, and restores the previous complete release on failure. `deploy-production.test.mjs` exercises drift detection and host rollback with disposable fixtures.
- `product-db.integration.mjs` creates, migrates, tests and removes a disposable PostgreSQL database, covering Fluo/Ligo/Rondo/Regado with Go race checks.
- `playwright.config.mjs` owns projects, worker limits, browser isolation, timeouts, failure artifacts and static integration startup. `ui-fixture.mjs` reuses worker-owned Vite/static servers and supplies synthetic identity; Playwright owns fresh contexts and teardown. `product-ui.test.mjs` checks Fluo history/composing/search and Ligo native scrolling/shared composer; `regado-ui.test.mjs` checks admin views, stale requests and access cases. Fixture identity is supplied only by the test server.
- `auth-live.integration.mjs` checks real Keycloak registration, TOTP/recovery, application SSO, posts/media, messaging and calls, then removes its temporary account.
- `local-backup.mjs` streams dumps to restic and verifies isolated restores. Tests use a temporary repository; they do not configure an independent production destination.

Fast unit/config/layout/dependency tests run without services. Database, live identity/media and backup tests need the local dependencies described in [local setup](../deploy/local/README.md). CI builds static apps once and runs the same layers in independent jobs plus vulnerability and workflow checks. Follow the [CI guide](../docs/ci.md) when adding or repairing tests. See [verification evidence](../docs/refactoring.md).
