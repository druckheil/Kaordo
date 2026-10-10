// Configures Rondo's SvelteKit build and local development server

import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { localViteServer, mediaDependencies } from '../../scripts/local-vite.mjs';

export default defineConfig({
	envDir: '../..',
	server: localViteServer('rondo'),
	ssr: { noExternal: ['@kaordo/media-client'] },
	optimizeDeps: {
		include: [
			'@kaordo/voice-client',
			'@kaordo/voice-client > livekit-client',
			// Rondo reaches the upload libraries through chat-ui; Vite resolves each step of the chain
			...mediaDependencies.map((dependency) => `@kaordo/chat-ui > ${dependency}`)
		]
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			paths: { base: '/rondo' }
		})
	]
});
