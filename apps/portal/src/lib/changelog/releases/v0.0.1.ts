// Records the user-facing changes included in the Kaordo 0.0.1 release

import type { ReleaseNotes } from '../types';

const release = {
	releasedAt: '2026-10-03',
	summary: "The first release brings Kaordo's connected apps and core services together.",
	sections: [
		{
			heading: 'Account and workspace',
			changes: [
				'Added the Portal with account registration, sign-in, TOTP, and one identity shared across the apps.',
				'Introduced the shared Rhea design system and independent app experiences.'
			]
		},
		{
			heading: 'Fluo',
			changes: [
				'Added a social feed with public and private posts, follows, replies, quotes, reactions, search, profiles, and saved posts.',
				'Added photo and video uploads, galleries, and playback.'
			]
		},
		{
			heading: 'Ligo',
			changes: [
				'Added direct and group conversations with paginated history and live updates.',
				'Messages support photos, videos and files, reactions, edits, deletion, and delivery and read receipts.'
			]
		},
		{
			heading: 'Rondo',
			changes: [
				'Added community servers and channels with membership, invitations, and channel messaging.',
				'Added LiveKit rooms for voice, camera, and screen sharing.'
			]
		}
	]
} satisfies ReleaseNotes;

export default release;
