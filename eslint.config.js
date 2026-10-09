// Lints TypeScript, Svelte and Node scripts with community-recommended rules; Prettier owns formatting
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

const typedSources = ['apps/**/*.{ts,svelte}', 'packages/**/*.{ts,svelte}'];

export default ts.config(
	{
		ignores: [
			'**/node_modules/',
			'**/.svelte-kit/',
			'**/build/',
			'**/dist/',
			'packages/contracts/src/openapi.d.ts'
		]
	},
	js.configs.recommended,
	ts.configs.recommended,
	{
		files: typedSources,
		extends: [ts.configs.strictTypeChecked, ts.configs.stylisticTypeChecked],
		rules: {
			// Arrow shorthand is the idiomatic form of Svelte event handlers
			'@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
			'@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }]
		}
	},
	// Svelte's parser must follow the TypeScript presets, which otherwise claim .svelte files
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{ languageOptions: { globals: { ...globals.browser, ...globals.node } } },
	// Runes such as $props and $state must stay `let`; the Svelte rule understands them
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		rules: { 'prefer-const': 'off', 'svelte/prefer-const': 'error' }
	},
	{
		files: typedSources,
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	}
);
