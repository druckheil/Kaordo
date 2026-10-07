// Checks direct dependency ownership with language parsers and explicit grammar regressions

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { importedPackages, packageName } from './dependency-imports.mjs';

const root = resolve(import.meta.dirname, '..');
const workspaces = ['apps', 'packages'].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, group, entry.name))
);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|js|mjs|svelte|ts)$/.test(entry.name) ? [path] : [];
  });
}

test('dependency scanning does not treat multiline UI copy as an import', () => {
  const fixture = (name) => readFileSync(join(root, 'scripts/fixtures', name), 'utf8');
  assert.deepEqual(importedPackages(fixture('dependency-copy.txt')), []);
  assert.deepEqual(importedPackages(fixture('dependency-imports.txt'), 'fixture.svelte'), ['@kaordo/ui', 'uplot', 'tailwindcss']);
  assert.deepEqual(importedPackages(`<div class="form" data-mode={mode === 'import' ? 'active' : ''}>Import from 'my dictionary'</div>`, 'copy.svelte'), []);
  assert.deepEqual(importedPackages(`<script>import Papa, { parse } from 'papaparse';\nexport * from '@kaordo/contracts';</script>\n{#await import('./Study.svelte')}{/await}`, 'example.svelte'), ['papaparse', '@kaordo/contracts']);
});

test('module parsing ignores comments and strings while retaining multiline and dynamic imports', () => {
  assert.deepEqual(importedPackages(`/* import Fake from 'fake'; */
    const copy = "import('not-a-dependency')";
    import Default,
      { named as value } from 'real-package/subpath';
    export type { Thing } from '@scope/types';
    const feature = import('lazy-library');
    const staticTemplate = import(\`template-library\`);
    const computed = import(\`computed-\${name}\`);
    import legacy = require('legacy-package');`), ['real-package', '@scope/types', 'lazy-library', 'template-library', 'legacy-package']);
});

test('Svelte template imports and CSS imports are parsed without guessing from copy', () => {
  assert.deepEqual(importedPackages(`<script lang="ts">import type { Thing } from '@scope/types';</script>
    <p>import('copy')</p>{#await import(\`actual-library\`)}{/await}`, 'view.svelte'), ['actual-library', '@scope/types']);
  assert.deepEqual(importedPackages(`/* @import 'fake'; */\n@import url("actual-style/theme.css");`, 'style.css'), ['actual-style']);
  for (const name of ['node:fs', 'fs', './local', '$app/state', 'https://example.test/style.css']) assert.equal(packageName(name), null);
});

function scanPackage(directory, sourceDirectory = join(directory, 'src')) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const files = sourceFiles(sourceDirectory);
  const imports = new Set();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const name of importedPackages(source, file)) imports.add(name);
  }
  imports.delete(null);
  return { manifest, imports };
}

const packages = [...workspaces.map((directory) => scanPackage(directory)), scanPackage(root, join(root, 'scripts'))];
const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));

for (const { manifest, imports } of packages) {
  test(`${manifest.name} declares only runtime dependencies imported by its source`, () => {
    const dependencies = Object.keys(manifest.dependencies ?? {});
    assert.deepEqual(
      dependencies.filter((dependency) => !imports.has(dependency)),
      [],
      'Remove unused runtime dependencies or add the intended source import.'
    );
  });

  test(`${manifest.name} declares each imported Kaordo package directly`, () => {
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));
    const undeclared = [...imports].filter((name) => workspaceNames.has(name) && !declared.has(name));
    assert.deepEqual(undeclared, [], 'Workspace imports must be declared in this package.');
  });

  test(`${manifest.name} declares every imported external package`, () => {
    const declared = new Set(Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies
    }));
    const undeclared = [...imports].filter((name) =>
      !name.startsWith('node:') && !workspaceNames.has(name) && !declared.has(name)
    );
    assert.deepEqual(undeclared, [], 'Source imports must be declared by the owning package.');
  });
}
