// Configures Memoro's static build and shared local development origin
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import {
	localViteServer,
	editorDependencies,
	mediaDependencies
} from '../../scripts/local-vite.mjs';

export default defineConfig({
	envDir: '../..',
	server: localViteServer('memoro'),
	// Memoro reaches upload libraries through memoro-client rather than a direct media-client dependency
	optimizeDeps: {
		include: [
			...editorDependencies,
			...mediaDependencies.map((dependency) => `@kaordo/memoro-client > ${dependency}`)
		]
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			paths: { base: '/memoro' }
		})
	]
});
