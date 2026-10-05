// Discovers released notes and loads each version module only when requested

import type { ReleaseNotes } from "./changelog/types";

export type { ReleaseNotes } from "./changelog/types";

const releaseModules = import.meta.glob<ReleaseNotes>("./changelog/releases/*.ts", {
	import: "default",
});

const releases = Object.entries(releaseModules)
	.flatMap(([path, load]) => {
		const version = path.match(/\/(v\d+\.\d+\.\d+)\.ts$/)?.[1];
		return version ? [{ version, load }] : [];
	})
	.sort((left, right) => compareVersions(right.version, left.version));

export const releaseVersions = releases.map(({ version }) => version);
export const latestReleasedVersion = releaseVersions[0] ?? null;

export async function loadReleaseNotes(version: string): Promise<ReleaseNotes> {
	const release = releases.find((entry) => entry.version === version);
	if (!release) throw new Error(`Release notes for ${version} are not available.`);
	return release.load();
}

function compareVersions(left: string, right: string): number {
	const leftParts = left.slice(1).split(".").map(Number);
	const rightParts = right.slice(1).split(".").map(Number);

	for (let index = 0; index < 3; index += 1) {
		const difference = leftParts[index] - rightParts[index];
		if (difference !== 0) return difference;
	}
	return 0;
}
