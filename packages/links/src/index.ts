// Defines canonical app routes and their shared TypeScript contract
type RootRelativePath = `/${string}`;

export const appPaths = {
  portal: '/',
  ligo: '/ligo/',
  fluo: '/fluo/',
  rondo: '/rondo/',
  regado: '/regado/'
} as const satisfies Record<string, RootRelativePath>;

export type KaordoAppId = keyof typeof appPaths;
export type KaordoAppPath = (typeof appPaths)[KaordoAppId];
