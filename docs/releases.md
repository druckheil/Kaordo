# Releases

## Public release notes

Portal shows release history from one module per shipped version: `apps/portal/src/lib/changelog/releases/vMAJOR.MINOR.PATCH.ts`. The filename is the version. The module default-exports a `ReleaseNotes` object (`../types.ts`) with `releasedAt` (ISO date), a `summary` and `sections` of user-facing changes. `apps/portal/src/lib/changelog.ts` discovers modules with a lazy `import.meta.glob` and loads each one when its entry is opened. Keep the glob lazy and do not add a central manifest. The newest module sets the version shown on Portal.

Writing notes:

- Compare the tagged tree with the previous release. Include only changes present at the tag; skip anything added and removed in between.
- Write short English entries about working behavior, grouped by app. Leave out refactors, test-only work, plans and reserved integrations.
- Release history is public. Never mention administration panels, privileged operations, host configuration, internal monitoring or operational access. Apply privacy corrections to older notes without changing their versions or dates.
- Never add unreleased work, and never delete earlier modules.

## Release procedure

Only for an explicitly authorized release:

1. Write the version module, including any privacy corrections to earlier notes.
2. Push the scope branch and get a complete green `Checks` run for that exact commit (see [CI](ci.md)).
3. Merge the scope into the latest `main`, push, and require a green `Checks` run on the merge commit.
4. Deploy that clean revision with `pnpm deploy:production` ([production](../deploy/nixos/README.md)). Confirm the active manifest, services and public responses match the tested commit.
5. Create an annotated `vX.Y.Z` tag at that revision and publish the GitHub release from the same notes. Do not attach deployment bundles. Record the CI run in `docs/ci.md`.
6. Start `scope-NEXT` from the released `main`, bump the root `package.json` version, commit, and create the annotated scope tag on that commit. The branch and the tag share a name, so push with explicit `refs/heads/…` and `refs/tags/…`.
