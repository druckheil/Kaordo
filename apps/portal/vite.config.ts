// Configures the Portal SvelteKit and Tailwind build

import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

function runesForFile(filename: string): boolean | undefined {
	const isDependency = filename.split(/[/\\]/).includes('node_modules');
	if (isDependency) return undefined;
	return true;
}

export default defineConfig({
	envDir: '../..',
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => runesForFile(filename)
			},
			adapter: adapter()
		})
	]
});
