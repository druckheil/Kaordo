// Defines canonical app routes and their shared TypeScript contract
type RootRelativePath = `/${string}`;

export const appPaths = {
	portal: '/',
	agordoj: '/agordoj/',
	ligo: '/ligo/',
	fluo: '/fluo/',
	rondo: '/rondo/',
	lingvo: '/lingvo/',
	memoro: '/memoro/',
	regado: '/regado/'
} as const satisfies Record<string, RootRelativePath>;

export type KaordoAppId = keyof typeof appPaths;
export type KaordoAppPath = (typeof appPaths)[KaordoAppId];

// Agordoj sections are portal pages that other apps link to directly
export const agordojPaths = {
	appearance: '/agordoj/appearance/',
	encryption: '/agordoj/encryption/'
} as const satisfies Record<string, RootRelativePath>;
