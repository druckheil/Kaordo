// Defines the available palettes and the shared default theme
import catalog from './catalog.json' with { type: 'json' };

export const themes = catalog;
export const defaultTheme = themes[0];

export function resolveTheme(id: string | undefined) {
	return themes.find((candidate) => candidate.id === id) ?? defaultTheme;
}
