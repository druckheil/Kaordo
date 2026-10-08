// Defines Fluo views, feed labels, and post layout estimates

import type { Feed } from "@kaordo/api-client";
import type { FluoPost } from "@kaordo/contracts";
import { mediaFrameHeightPx } from "@kaordo/media-ui";

export type FluoSettingsSection = "notifications" | "privacy";
export type FluoView = "feed" | "search" | "notifications" | "saved" | "profile" | "settings" | `settings/${FluoSettingsSection}`;

export const profileNavigationKey = Symbol('fluo-profile-navigation');

export const fluoViews: Record<FluoView, {
	title: string;
	description: string;
	settingsSection?: FluoSettingsSection;
}> = {
	feed: { title: "Feed", description: "Ideas, moments and conversations." },
	search: { title: "Search", description: "Find posts by text or author." },
	notifications: { title: "Notifications", description: "Updates from your community." },
	saved: { title: "Saved posts", description: "Keep good things close." },
	profile: { title: "Profile", description: "Everything you have shared." },
	settings: { title: "Settings", description: "Make Fluo work for you." },
	"settings/notifications": {
		title: "Notifications", description: "Choose which updates reach you.", settingsSection: "notifications"
	},
	"settings/privacy": {
		title: "Privacy", description: "Decide who sees your posts and likes.", settingsSection: "privacy"
	},
};

export function isFluoView(value: unknown): value is FluoView {
	return typeof value === "string" && Object.hasOwn(fluoViews, value);
}

export function isFluoSettingsView(view: FluoView): boolean {
	return view === "settings" || fluoViews[view].settingsSection !== undefined;
}

export function fluoViewFromHash(hash: string): FluoView | null {
	if (profileUsernameFromHash(hash)) return 'profile';
	const view = hash.replace(/^#/, "");
	return isFluoView(view) ? view : null;
}

export function profileHashForUsername(username: string): string {
	return `#profile/${encodeURIComponent(username)}`;
}

export function profileUsernameFromHash(hash: string): string | null {
	const match = /^#profile\/(.+)$/.exec(hash);
	if (!match) return null;
	try {
		const username = decodeURIComponent(match[1]);
		return username.length <= 255 && !username.includes('\0') ? username : null;
	} catch { return null; }
}

export function postHashForId(id: string): string {
	return `#post/${id}`;
}

export function postIdFromHash(hash: string): string | null {
	const match = /^#post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash);
	return match?.[1] ?? null;
}

export function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}

export function feedForView(view: FluoView, selectedFeed: Feed): Feed {
	if (view === "profile") return "mine";
	if (view === "saved") return "saved";
	return selectedFeed;
}

export function estimatePostHeight(
	post: FluoPost | undefined,
	contentWidth: number,
	viewportWidth: number,
	rootFontSize: number,
): number {
	if (!post) return 320;

	const mediaHeight = mediaFrameHeightPx(post.media, contentWidth, rootFontSize);
	const textLines = Math.ceil(post.text.length / Math.max(30, contentWidth / 7));
	const quoteMediaHeight = post.quote?.media.length
		? Math.ceil(post.quote.media.length / 2) * (viewportWidth >= 640 ? 144 : 112)
		: 0;
	const quoteHeight = post.quote ? 72 + quoteMediaHeight : 0;

	return 220 + mediaHeight + textLines * 22 + quoteHeight;
}

export function feedEmptyTitle(view: FluoView, feed: Feed): string {
	if (view === "saved") return "No saved posts yet.";
	if (view === "search") return "No matching posts.";
	if (view === "profile") return "You have not posted yet.";
	if (view === "feed" && feed === "following") return "No posts from people you follow yet.";
	if (view === "feed") return "The feed is ready for its first post.";
	return "There is nothing to show here yet.";
}

export function feedEmptyDescription(view: FluoView, feed: Feed): string {
	if (view === "saved") return "Save a post to keep it in your private list.";
	if (view === "search") return "Try another phrase or username.";
	if (view === "profile") return "Posts you publish will appear on your profile.";
	if (view === "feed" && feed === "following") return "Follow an author in Latest to see their posts here.";
	if (view === "feed") return "Use Post to share a thought, photo or video.";
	return "There is nothing to show here yet.";
}
