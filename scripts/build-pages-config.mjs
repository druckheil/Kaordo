// Resolves public browser endpoints for local and production app builds
export function createBuildEnvironment(production, environment = process.env) {
  if (!production) return environment;

  const configuredOrigin = new URL(environment.KAORDO_PUBLIC_ORIGIN || 'https://kaordo.link');
  if (
    configuredOrigin.protocol !== 'https:' ||
    configuredOrigin.username ||
    configuredOrigin.password ||
    configuredOrigin.pathname !== '/' ||
    configuredOrigin.search ||
    configuredOrigin.hash
  ) {
    throw new Error('KAORDO_PUBLIC_ORIGIN must be a plain HTTPS origin');
  }

  return {
    ...environment,
    VITE_KAORDO_AUTH_URL: configuredOrigin.origin,
    VITE_KAORDO_AUTH_REALM: environment.KAORDO_PUBLIC_AUTH_REALM || 'kaordo',
    VITE_KAORDO_AUTH_CLIENT_ID: environment.KAORDO_PUBLIC_AUTH_CLIENT_ID || 'kaordo-web',
    VITE_KAORDO_API_URL: configuredOrigin.origin,
    VITE_KAORDO_NODO_URL: configuredOrigin.origin
  };
}
