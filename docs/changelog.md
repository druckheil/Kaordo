# Release changelog

The Portal release history is data-driven. Keep release content in versioned TypeScript modules and keep rendering, loading, and ordering in the shared changelog code.

## Adding a released version

1. Add `apps/portal/src/lib/changelog/releases/vMAJOR.MINOR.PATCH.ts` for each published release.
2. Export one default object that satisfies the `ReleaseNotes` type in `apps/portal/src/lib/changelog/types.ts`.
3. Use the filename as the canonical version identifier, with the leading `v`. Record `releasedAt` as an ISO date (`YYYY-MM-DD`).
4. Review the commits since the previous release and compare the final tagged tree. For the first release, compare it with the project baseline. Add only changes present at the tag; omit changes that were introduced and removed before the release.
5. Keep entries short, user-facing, and in English. Group related changes by app or capability. Describe working behavior, not implementation steps, plans, or reserved integrations.
6. Preserve all prior release modules. Do not add unreleased work to this public history.

Release history is public. Exclude administration panels, privileged operations,
host configuration, internal monitoring, and operational access details from
both Portal notes and GitHub release descriptions. Apply privacy corrections to
older descriptions while preserving their versions and release dates. Keep
verification and deployment evidence in the internal engineering documentation.

## Data and loading rules

- The filename is the version identifier. The per-version module is the source of truth for its date, summary, and grouped changes. Do not duplicate release details in a central manifest or in the page component.
- `apps/portal/src/lib/changelog.ts` discovers modules with `import.meta.glob` and sorts semantic versions newest first. Keep the glob lazy; do not enable `eager` or load every module while constructing the version list.
- The page displays filenames as version entries, then imports a version module the first time its disclosure is opened. Keep the loaded notes cached for the lifetime of the page.
- Add one module for every release that has shipped. The latest module determines the version shown in the Portal welcome panel.
- Keep release summaries concise and specific. Avoid listing small refactors, test-only work, internal fixes without a user-visible effect, or the same change under multiple sections.

## Release module shape

```ts
// Records the user-facing changes included in this release

import type { ReleaseNotes } from "../types";

const release = {
	releasedAt: "2026-10-03",
	summary: "A short description of the release.",
	sections: [
		{
			heading: "Fluo",
			changes: ["A concise description of a user-visible change."],
		},
	],
} satisfies ReleaseNotes;

export default release;
```

## Completing an explicitly authorized release

1. Prepare the versioned notes from the final scope changes, including privacy
   corrections to prior Portal and GitHub descriptions. Keep unreleased work out
   of the public history.
2. Push the release work and diagnose complete `Checks` runs by exact commit.
   Fix the first failed action; preserve all validation layers and assertions.
3. Merge the scope into the latest `main`, preserving existing work. Push and
   require a successful complete `Checks` run for the final main revision.
4. Deploy that clean revision with `deploy:production` using the
   [production workflow](../deploy/nixos/README.md). Confirm the active manifest,
   installed services and public responses against the tested commit.
5. Create an annotated `vMAJOR.MINOR.PATCH` tag at that revision and publish the
   GitHub release from the same canonical public notes. Keep internal deployment
   bundles out of public release assets. Record exact CI and deployment evidence
   in `docs/ci.md`.
6. Start `scope-NEXT_VERSION` from the released main revision, bump the root
   package version, commit, and create the matching annotated scope tag at that
   initial commit. Push the branch and tag using explicit `refs/heads/...` and
   `refs/tags/...`: they share a name. Verify the new scope's complete `Checks`
   run. Its public history continues to show the latest shipped version until
   the next release.
