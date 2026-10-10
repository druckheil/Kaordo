// Configures Memoro's static build and shared local development origin
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { localViteDependencies, localViteServer } from '../../scripts/local-vite.mjs';

export default defineConfig({
	envDir: '../..',
	server: localViteServer('memoro'),
	optimizeDeps: localViteDependencies,
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
