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
			'@typescript-eslint/no-invalid-void-type': ['error', { allowAsThisParameter: true }],
			// Empty labels need fallbacks; booleans use logical alternatives rather than null defaults
			'@typescript-eslint/prefer-nullish-coalescing': [
				'error',
				{ ignorePrimitives: { string: true, boolean: true } }
			],
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
		files: ['**/*.svelte'],
		// $bindable() declares two-way props even when it does not supply a default value
		rules: { '@typescript-eslint/no-useless-default-assignment': 'off' }
	},
	{
		files: ['apps/{fluo,ligo,rondo}/**/*.{svelte,ts}'],
		// Shallow history in these apps changes fragments on the current route
		rules: {
			'svelte/no-navigation-without-resolve': [
				'error',
				{ ignorePushState: true, ignoreReplaceState: true }
			]
		}
	},
	{
		files: ['packages/ui/src/lib/components/ui/button/button.svelte'],
		// App callers provide resolved routes or external URLs to the shared button
		rules: { 'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }] }
	},
	{
		files: ['scripts/ui-fixture.mjs'],
		// Playwright requires a destructured fixture parameter, including for fixture-free setup
		rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] }
	},
	{
		files: ['**/*.svelte'],
		// Svelte snippet render expressions intentionally return void
		settings: { svelte: { ignoreWarnings: ['@typescript-eslint/no-confusing-void-expression'] } }
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
