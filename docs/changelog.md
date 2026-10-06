# Release changelog

The Portal release history is data-driven. Keep release content in versioned TypeScript modules and keep rendering, loading, and ordering in the shared changelog code.

## Adding a released version

1. Add `apps/portal/src/lib/changelog/releases/vMAJOR.MINOR.PATCH.ts` for each published release.
2. Export one default object that satisfies the `ReleaseNotes` type in `apps/portal/src/lib/changelog/types.ts`.
3. Use the filename as the canonical version identifier, with the leading `v`. Record `releasedAt` as an ISO date (`YYYY-MM-DD`).
4. Review the commits since the previous release and compare the final tagged tree. For the first release, compare it with the project baseline. Add only changes present at the tag; omit changes that were introduced and removed before the release.
5. Keep entries short, user-facing, and in English. Group related changes by app or capability. Describe working behavior, not implementation steps, plans, or reserved integrations.
6. Preserve all prior release modules. Do not add unreleased work to this public history.

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
