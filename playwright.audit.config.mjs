// Reuses UI scenarios in WebKit and Firefox with one owner for generated Vite source

import base from './playwright.config.mjs';

const scenarios = base.projects.find((project) => project.name === 'browser').testMatch;

export default {
	...base,
	outputDir: './dist/test-results/ui-engines',
	workers: 1,
	webServer: undefined,
	use: { ...base.use, launchOptions: {} },
	projects: [
		{
			name: 'webkit-audit',
			testMatch: scenarios,
			// Touch emulation and Windows forced colors are verified by the main Chromium suite
			grepInvert: /Touch interaction/,
			use: { browserName: 'webkit' }
		},
		{
			name: 'firefox-audit',
			testMatch: scenarios,
			grepInvert: /Touch interaction|pastes clipboard/,
			use: { browserName: 'firefox' }
		},
		{
			// Headless Firefox advertises PNG paste but returns null instead of the platform file
			name: 'firefox-clipboard',
			testMatch: ['product-ui.test.mjs'],
			grep: /pastes clipboard/,
			use: { browserName: 'firefox', headless: false }
		}
	]
};
