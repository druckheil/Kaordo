// Records the user-facing changes included in the Kaordo 0.0.2 release

import type { ReleaseNotes } from "../types";

const release = {
	releasedAt: "2026-10-06",
	summary: "0.0.2 expands Fluo conversations, adds persistent account themes and sign-in, and brings verified storage controls to Regado.",
	sections: [
		{
			heading: "Account and Portal",
			changes: [
				"Added shared light and dark themes with matching appearance across the apps and sign-in pages.",
				"Remembered sign-ins now last up to 30 days of inactivity, with a five-year maximum session lifetime.",
		],
		},
		{
			heading: "Fluo",
			changes: [
				"Posts open in a focused thread view with parent context, paginated replies, and full post interactions on replies.",
				"Added post context actions and visibility controls, and kept a clear placeholder when a quoted post is deleted.",
				"Improved multi-photo galleries and carousel navigation, and made the Following feed show only followed accounts' posts.",
		],
		},
		{
			heading: "Regado",
			changes: [
				"Added validated storage layouts and replication health controls for the NixOS server.",
				"Added journal retention controls and clearer service and system metrics.",
			],
		},
	],
} satisfies ReleaseNotes;

export default release;
