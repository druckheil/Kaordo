// Prevents new regression files from silently falling outside the declared test suites

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import browserConfig from '../playwright.config.mjs';
import auditConfig from '../playwright.audit.config.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const files = readdirSync(import.meta.dirname).filter((name) => /\.(?:test|integration)\.mjs$/.test(name));
const unitFiles = new Set(manifest.scripts['test:unit'].match(/scripts\/[\w.-]+\.mjs/g).map((path) => path.slice(8)));
const browserFiles = new Set(browserConfig.projects.flatMap(({ testMatch }) => testMatch));
const artifactFiles = new Set(['pages.test.mjs', 'pages-production.test.mjs']);
const databaseFiles = new Set(manifest.scripts['test:product:db'].match(/scripts\/[\w.-]+\.mjs/g).map((path) => path.slice(8)));

test('hosted browser shards use native test-level distribution with one fixture owner per runner', () => {
  const workflow = readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
  assert.match(workflow, /fail-fast: false\s+matrix:\s+shard: \[1, 2\]/);
  assert.match(workflow, /run: pnpm test:ui --fully-parallel --workers=1 --shard=\$\{\{ matrix\.shard \}\}\/2/);
  assert.match(workflow, /name: browser-failure-\$\{\{ matrix\.shard \}\}/);
});

test('every regression file has an explicit unit, browser, live, database or artifact suite', () => {
  assert.deepEqual(files.filter((name) => !unitFiles.has(name) && !browserFiles.has(name) && !artifactFiles.has(name) && !databaseFiles.has(name)), [],
    'Assign new regression files to test:unit, a Playwright project or an artifact verification suite');
  for (const name of [...unitFiles, ...browserFiles, ...artifactFiles, ...databaseFiles]) {
    assert.ok(files.includes(name), `Declared regression file must exist: ${name}`);
  }
});

test('live integration includes complete identity/product journeys and isolated backup recovery', () => {
  const live = browserConfig.projects.find(({ name }) => name === 'live');
  assert.deepEqual(live.testMatch, ['auth-live.integration.mjs', 'backup-live.integration.mjs']);
  assert.equal(live.use.trace, 'off', 'Credential flows cannot record network traces');
  assert.equal(live.use.screenshot, 'off', 'Native identity forms expose temporary recovery credentials');
  assert.equal(browserConfig.retries, 0, 'Retries cannot hide a failed regression');
  assert.match(manifest.scripts['test:integration'], /--project=live --workers=1/);
  assert.doesNotMatch(manifest.scripts['test:integration'], /--grep|identity-only/);
});

test('browser engine audit preserves every synthetic scenario without credential traces or retries', () => {
  const scenarios = browserConfig.projects.find(({ name }) => name === 'browser').testMatch;
  const [webkit, firefox, clipboard] = auditConfig.projects;
  assert.equal(auditConfig.workers, 1, 'One owner must generate Vite source during engine verification');
  assert.equal(auditConfig.retries, 0);
  assert.equal(auditConfig.webServer, undefined, 'The synthetic audit cannot start credential services');
  assert.deepEqual(webkit.testMatch, scenarios);
  assert.deepEqual(firefox.testMatch, scenarios);
  assert.deepEqual(clipboard.testMatch, ['product-ui.test.mjs']);
  assert.equal(clipboard.use.headless, false, 'Native PNG paste requires a platform clipboard in Firefox');
  assert.ok(clipboard.grep.test('Ligo pastes clipboard media'));
  assert.ok(firefox.grepInvert.test('Ligo pastes clipboard media'));
  assert.ok(!webkit.grepInvert.test('Ligo pastes clipboard media'));
  for (const project of auditConfig.projects) {
    assert.ok(!project.testMatch.includes('auth-live.integration.mjs'));
  }
});
