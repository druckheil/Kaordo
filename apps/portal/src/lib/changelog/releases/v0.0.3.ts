// Records the user-facing changes included in the Kaordo 0.0.3 release

import type { ReleaseNotes } from "../types";

const release = {
	releasedAt: "2026-10-08",
	summary: "0.0.3 introduces Lingvo for learning German, adds Fluo activity and privacy controls, and improves conversations, calls, and accessibility across the apps.",
	sections: [
		{
			heading: "Lingvo",
			changes: [
				"Added private German dictionaries with English or Russian as your native language, with separate cards and learning progress for each language pair.",
				"Learn words with flashcards and practice phrases through word arrangement and written recall. FSRS spaces reviews according to your answers, with pronunciation and review undo.",
				"Organize cards into folders, track daily goals and study activity, and add noun articles, plurals, grammar, examples, and notes.",
				"Import and export dictionary content as CSV. Copy an AI prompt, paste the completed template, and apply it to the card form before saving.",
			],
		},
		{
			heading: "Fluo",
			changes: [
				"Added activity notifications for likes, negative reactions, replies, quotes, follows, and optional unfollows, with an unread count and read status saved to your account.",
				"Open related posts from notifications, preview their media, and mark individual notifications or all notifications as read. Repeated actions are limited to one notification per hour; each new reply or quote remains separate.",
				"Choose which activities notify you: everyone, followed accounts, or no one. Private accounts limit posts to accounts you follow; hidden likes keep the count without revealing your identity.",
				"Replaced the floating dislike control with an accessible reaction menu, an animated red heart, and a stronger X for negative reactions.",
				"Improved post, reply, and quote composers with stable sizing, scrolling, compact options, and clearer visibility controls. The submit action now reflects Post, Reply, Quote, or Repost.",
			],
		},
		{
			heading: "Ligo and Rondo",
			changes: [
				"Paste photos and videos from the clipboard into Fluo posts and Ligo or Rondo messages, with attachment previews and upload feedback.",
				"Added Rondo call settings for microphone, speaker, and camera selection, volume, saved device defaults, and microphone and speaker tests.",
				"Improved message scrolling, media layout, call feedback, and recovery when a device or saved preference is unavailable.",
			],
		},
		{
			heading: "Workspace and accessibility",
			changes: [
				"Made app headers more compact and improved navigation, visual hierarchy, typography, spacing, and feedback across the workspace.",
				"Improved keyboard focus, accessible names, touch targets, color contrast, narrow-screen layouts, enlarged text, and reduced-motion behavior.",
				"Made settings choices respond without flickering and kept notification lists in place when their unread state changes.",
			],
		},
	],
} satisfies ReleaseNotes;

export default release;
