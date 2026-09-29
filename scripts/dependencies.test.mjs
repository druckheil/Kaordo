import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
    return /\.(?:css|js|svelte|ts)$/.test(entry.name) ? [path] : [];
  });
}

function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('$') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function scanPackage(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const files = sourceFiles(join(directory, 'src'));
  const imports = new Set();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const pattern = /(?:from\s*|import\s*(?:\(\s*)?|@import\s*)['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) imports.add(packageName(match[1]));
  }
  imports.delete(null);
  return { manifest, imports };
}

const packages = workspaces.map(scanPackage);
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
}

