// Defines Fluo views, feed labels, and post layout estimates

import type { Feed } from "@kaordo/api-client";
import type { FluoPost } from "@kaordo/contracts";
import { mediaFrameHeightPx } from "@kaordo/media-ui";

export type FluoView = "feed" | "search" | "notifications" | "saved" | "profile" | "settings";

export const fluoViews: readonly FluoView[] = [
	"feed",
	"search",
	"notifications",
	"saved",
	"profile",
	"settings",
];

const viewTitles: Record<FluoView, string> = {
	feed: "Feed",
	search: "Search",
	notifications: "Notifications",
	saved: "Saved posts",
	profile: "Profile",
	settings: "Settings",
};

const viewDescriptions: Record<FluoView, string> = {
	feed: "Ideas, moments and conversations.",
	search: "Find posts by text or author.",
	notifications: "Updates from your community.",
	saved: "Keep good things close.",
	profile: "Everything you have shared.",
	settings: "Your account at a glance.",
};

export function isFluoView(value: unknown): value is FluoView {
	return typeof value === "string" && fluoViews.includes(value as FluoView);
}

export function fluoViewFromHash(hash: string): FluoView | null {
	const view = hash.replace(/^#/, "");
	return isFluoView(view) ? view : null;
}

export function postHashForId(id: string): string {
	return `#post/${id}`;
}

export function postIdFromHash(hash: string): string | null {
	const match = /^#post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash);
	return match?.[1] ?? null;
}

export function titleForView(view: FluoView): string {
	return viewTitles[view];
}

export function descriptionForView(view: FluoView): string {
	return viewDescriptions[view];
}

export function displayInitial(displayName: string): string {
	return displayName.trim()[0]?.toLocaleUpperCase() ?? "K";
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
