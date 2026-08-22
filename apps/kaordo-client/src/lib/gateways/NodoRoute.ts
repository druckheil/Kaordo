import type { NodoAccess } from '../domain/nodo';

export type NodoRouteCandidate = NodoAccess['candidates'][number];

/**
 * Orders routes for the current runtime. A Tauri WebView can resolve an
 * IPv6 health request but still be unable to stream a long HTTP body to that
 * address. When an IPv6-only host has the HTTPS relay, prefer that stable
 * route while preserving LAN and direct IPv4 fast paths.
 */
export function orderedNodoCandidates(access: NodoAccess): NodoRouteCandidate[] {
  const seen = new Set<string>();
  const candidates = access.candidates
    .filter((candidate) => candidate.kind === 'lan' || candidate.kind === 'public' || candidate.kind === 'relay')
    .filter((candidate) => {
      const key = `${candidate.address}:${candidate.port}:${candidate.origin ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const preferRelay = isTauriRuntime() &&
    !candidates.some(({ kind }) => kind === 'lan') &&
    candidates.some(({ kind }) => kind === 'relay') &&
    candidates.some(({ kind, address }) => kind === 'public' && address.includes(':'));
  return candidates.sort((left, right) => routePriority(right, preferRelay) - routePriority(left, preferRelay));
}

export function nodoOrigin(candidate: NodoRouteCandidate): string {
  if (candidate.origin) return candidate.origin.replace(/\/$/u, '');
  const host = candidate.address.includes(':') ? `[${candidate.address}]` : candidate.address;
  return `http://${host}:${candidate.port}`;
}

export function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in globalThis;
}

function routePriority(candidate: NodoRouteCandidate, preferRelay: boolean): number {
  if (candidate.kind === 'lan') return 3;
  if (candidate.kind === 'relay') return preferRelay ? 2 : 1;
  return preferRelay ? 1 : 2;
}
