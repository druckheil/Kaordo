// Configures Lingvo's static build and one-origin local development server
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { localViteServer } from '../../scripts/local-vite.mjs';

export default defineConfig({
  envDir: '../..',
  server: localViteServer('lingvo'),
  plugins: [tailwindcss(), sveltekit({
    compilerOptions: {
      runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
    },
    adapter: adapter(),
    paths: { base: '/lingvo' }
  })]
});
