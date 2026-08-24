import type { AuthUser } from './auth';

export type AppSection = 'agordoj' | 'fluo' | 'ilo' | 'klaro' | 'ligo' | 'mi' | 'nodo' | 'regado' | 'rondo';

export type AppSectionDefinition = {
  description: string;
  id: AppSection;
  label: string;
};

export const APP_SECTIONS: ReadonlyArray<AppSectionDefinition> = [
  { description: 'Public social feed', id: 'fluo', label: 'Fluo' },
  { description: 'Direct messages and file sharing', id: 'ligo', label: 'Ligo' },
  { description: 'Community spaces and group communication', id: 'rondo', label: 'Rondo' },
  { description: 'Personal data node', id: 'nodo', label: 'Nodo' },
  { description: 'Knowledge and encyclopedias', id: 'klaro', label: 'Klaro' },
  { description: 'Language tools and personal learning', id: 'ilo', label: 'Ilo' },
  { description: 'Your profile', id: 'mi', label: 'Mi' },
  { description: 'Application appearance and scale', id: 'agordoj', label: 'Agordoj' },
  { description: 'Administration and service health', id: 'regado', label: 'Regado' },
];

export function appSectionsFor(role: AuthUser['role']): ReadonlyArray<AppSectionDefinition> {
  return role === 'superadmin'
    ? APP_SECTIONS
    : APP_SECTIONS.filter((section) => section.id !== 'regado');
}

export function appSectionLabel(section: AppSection): string {
  return APP_SECTIONS.find((candidate) => candidate.id === section)?.label ?? 'Kaordo';
}
