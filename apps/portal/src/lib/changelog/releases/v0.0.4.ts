// Records the user-facing changes included in the Kaordo 0.0.4 release

import type { ReleaseNotes } from '../types';

const release = {
	releasedAt: '2026-10-10',
	summary:
		'0.0.4 adds Memoro for daily plans and memories, encrypts content on your devices, and introduces Fluo profiles, device approval, recovery keys, and session management.',
	sections: [
		{
			heading: 'Memoro',
			changes: [
				'Added a private diary with a calendar, daily tasks, and a journal for each day. Calendar indicators show which days have entries.',
				'Organize tasks by category, add an optional time and status, and mark tasks as done. Write formatted notes and attach photos or videos to tasks and journal entries.',
				'Journal changes save automatically and finish saving before you switch days. Unsaved task drafts ask for confirmation before you leave.'
			]
		},
		{
			heading: 'Encryption and recovery',
			changes: [
				'Content is encrypted on your device before upload: Fluo posts and attachments, Ligo and Rondo messages and attachments, community details, Lingvo dictionaries and learning history, and Memoro entries.',
				'Approve a new browser from an existing device by comparing device fingerprints, or unlock it with your recovery key after signing in.',
				'Create and download a recovery key, confirm that you saved it, and activate it to restore access if you lose your approved devices. You can replace the active recovery key from settings.'
			]
		},
		{
			heading: 'Fluo',
			changes: [
				'Added profile pages with an avatar, banner, bio, pronouns, and optional birthday, location, and website. Crop profile images before uploading and browse followers and following from each profile.',
				'Choose an online, busy, or invisible status and control who can see your presence. Shared avatars show the presence information available to you.',
				'Public posts remain readable by their audience; private accounts share post keys with accounts they follow, while Only me posts stay private.',
				'Search encrypted posts on your device and continue through older posts with Search older posts. Images load near the viewport; videos and files load when opened.'
			]
		},
		{
			heading: 'Ligo, Rondo, and Lingvo',
			changes: [
				'Added encryption for conversation and group titles, community and channel names, and Rondo voice and video calls.',
				'Messages are encrypted for the members present when they are sent. Members added later see earlier messages as unavailable.',
				'Lingvo stores dictionaries and learning progress as encrypted records while keeping flashcards, phrase exercises, CSV transfer, and review scheduling available on your devices.'
			]
		},
		{
			heading: 'Account and settings',
			changes: [
				'Split settings into Appearance and Encryption & recovery, with a pending-device count on the settings link.',
				'View every signed-in session with its browser, operating system, device, IP address, and activity times. See whether its device created the keys, was approved by another device, used recovery, or is waiting for access.',
				'Sign out an individual session or all other sessions, approve waiting devices, and remove device key access or pending requests. Devices without an active session are listed separately.'
			]
		}
	]
} satisfies ReleaseNotes;

export default release;
