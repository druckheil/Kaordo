// Configures Ligo's SvelteKit build, shared workspace dependencies, and Pages base path

import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { localViteServer, mediaDependencies } from '../../scripts/local-vite.mjs';

function runesModeForFile(filename: string): boolean | undefined {
	return filename.split(/[/\\]/).includes('node_modules') ? undefined : true;
}

export default defineConfig({
	envDir: '../..',
	server: localViteServer('ligo'),
	ssr: { noExternal: ['@kaordo/media-client'] },
	optimizeDeps: { include: mediaDependencies },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for project files while preserving library defaults
				runes: ({ filename }) => runesModeForFile(filename)
			},
			adapter: adapter(),
			paths: { base: '/ligo' }
		})
	]
});
