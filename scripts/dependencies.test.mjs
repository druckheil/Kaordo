// Checks declared dependency ownership without mistaking application copy for module imports

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

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

function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('$') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function importedPackages(source) {
  const patterns = [
    /^\s*(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+|\*)\s+from\s*['"]([^'"\r\n]+)['"]/gm,
    /^\s*import\s+['"]([^'"\r\n]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"\r\n]+)['"]/g,
    /^\s*@import\s+['"]([^'"\r\n]+)['"]/gm,
  ];
  return patterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => packageName(match[1]))).filter(Boolean);
}

test('dependency scanning does not treat multiline UI copy as an import', () => {
  const fixture = (name) => readFileSync(join(root, 'scripts/fixtures', name), 'utf8');
  assert.deepEqual(importedPackages(fixture('dependency-copy.txt')), []);
  assert.deepEqual(importedPackages(fixture('dependency-imports.txt')), ['@kaordo/ui', 'uplot', 'tailwindcss']);
  assert.deepEqual(importedPackages(`<div class="form" data-mode={mode === 'import' ? 'active' : ''}>Import from 'my dictionary'</div>`), []);
  assert.deepEqual(importedPackages(`import Papa, { parse } from 'papaparse';\nexport * from '@kaordo/contracts';\n{#await import('./Study.svelte')}`), ['papaparse', '@kaordo/contracts']);
});

function scanPackage(directory, sourceDirectory = join(directory, 'src')) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const files = sourceFiles(sourceDirectory);
  const imports = new Set();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const name of importedPackages(source)) imports.add(name);
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
