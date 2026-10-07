// Checks assembled static routes, local assets and the lazy-loading budget

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { createPageServer } from './serve-pages.mjs';

const site = resolve(import.meta.dirname, '../dist/pages');
const fluoClient = resolve(import.meta.dirname, '../apps/fluo/.svelte-kit/output/client');
const routes = ['/', '/login/', '/register/', '/agordoj/', '/changelog/', '/ligo/', '/fluo/', '/rondo/', '/lingvo/', '/regado/'];

function pageAt(route) {
  const file = join(site, route, 'index.html');
  assert.ok(existsSync(file), `missing prerendered page: ${route}`);
  return readFileSync(file, 'utf8');
}

test('public applications have prerendered pages; Regado stays out of the app directory', () => {
  const portal = pageAt('/');
  assert.match(portal, /href="\/fluo\/"/);
  for (const app of ['ligo', 'fluo', 'rondo', 'lingvo', 'regado']) {
    const html = pageAt(`/${app}/`);
    assert.match(html, /Checking your account/);
    assert.match(html, /<a\b(?=[^>]*href="\/")(?=[^>]*aria-label="Kaordo home")[^>]*>/,
      `${app} must render a working home link regardless of component ownership`);
  }
  for (const name of ['Ligo', 'Rondo', 'Lingvo']) {
    assert.match(portal, new RegExp(name));
  }
  assert.doesNotMatch(portal, /Regado|In development/);
});

test('public release notes contain valid user-facing content without private administration details', async () => {
  const directory = resolve(import.meta.dirname, '../apps/portal/src/lib/changelog/releases');
  const filenames = readdirSync(directory);
  assert.ok(filenames.length > 0, 'at least one released version must exist');
  for (const filename of filenames) {
    assert.match(filename, /^v\d+\.\d+\.\d+\.ts$/);
    const { default: release } = await import(pathToFileURL(join(directory, filename)).href);
    assert.match(release.releasedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(release.releasedAt).toISOString().slice(0, 10), release.releasedAt);
    assert.ok(release.summary.trim());
    assert.ok(release.sections.length > 0);
    for (const section of release.sections) {
      assert.ok(section.heading.trim());
      assert.ok(section.changes.length > 0);
      assert.ok(section.changes.every(change => typeof change === 'string' && change.trim()));
    }
    assert.doesNotMatch(JSON.stringify(release), /\b(?:Regado|admin(?:istration|istrator|s)?|NixOS|Prometheus|Node Exporter|DDNS)\b/i,
      `${filename} must not publish private administration or host details`);
  }
});

test('authentication entry points are prerendered without showing guest actions before session resolution', () => {
  const portal = pageAt('/');
  assert.match(portal, /Checking your session/);
  assert.doesNotMatch(portal, /href="\/login\/"/);
  assert.doesNotMatch(portal, /href="\/register\/"/);
  const login = pageAt('/login/');
  const register = pageAt('/register/');
  assert.match(login, /Sign in/);
  assert.match(register, /Opening your registration form/);
  assert.doesNotMatch(login, />Continue to sign in</);
  assert.doesNotMatch(register, />Continue to registration</);
});

test('the static Pages artifact includes the Keycloak silent SSO callback', () => {
  const callback = readFileSync(join(site, 'silent-check-sso.html'), 'utf8');
  assert.match(callback, /parent\.postMessage\(location\.href, location\.origin\)/);
});

test('the local static server canonicalizes app paths before relative assets resolve', async () => {
  const server = createPageServer(site);
  server.listen(0, '127.0.0.1');
  await new Promise((resolveListen) => server.once('listening', resolveListen));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const route = await fetch(`${origin}/regado?tab=storage`, { redirect: 'manual' });
    assert.equal(route.status, 308);
    assert.equal(route.headers.get('location'), '/regado/?tab=storage');

    const page = await fetch(new URL(route.headers.get('location'), origin));
    assert.equal(page.status, 200);
    const html = await page.text();
    const stylesheet = html.match(/href="([^"]+\.css)" rel="stylesheet"/)?.[1];
    const clientScript = html.match(/href="([^"]+\.js)" rel="modulepreload"/)?.[1];
    assert.ok(stylesheet, 'Regado page should include its stylesheet');
    assert.ok(clientScript, 'Regado page should include its client entry');
    assert.equal((await fetch(new URL(stylesheet, page.url))).status, 200);
    assert.equal((await fetch(new URL(clientScript, page.url))).status, 200);
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});

test('all local HTML asset references exist in the Pages artifact', () => {
  for (const route of routes) {
    const html = pageAt(route);
    for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (!reference.startsWith('./') && !reference.startsWith('/')) continue;
      const target = new URL(reference, `http://localhost${route}`).pathname;
      assert.ok(existsSync(join(site, target)), `${route} references missing ${reference}`);
    }
  }
});

test('Fluo keeps its initial JavaScript under budget and lazy-loads the editor and media clients', () => {
  const manifest = JSON.parse(readFileSync(join(fluoClient, '.vite/manifest.json'), 'utf8'));
  const page = Object.entries(manifest).find(([, item]) => item.isEntry && item.file.includes('/nodes/2.'));
  assert.ok(page, 'Fluo page entry must be present in the client manifest');

  const initialModules = new Set();
  const visit = (key) => {
    if (initialModules.has(key)) return;
    const item = manifest[key];
    assert.ok(item, `missing manifest entry for ${key}`);
    initialModules.add(key);
    for (const dependency of item.imports ?? []) visit(dependency);
  };
  visit(page[0]);

  const gzipBytes = [...initialModules].reduce((total, key) => {
    const file = join(site, 'fluo', manifest[key].file);
    assert.ok(existsSync(file), `missing Fluo JavaScript module: ${manifest[key].file}`);
    return total + gzipSync(readFileSync(file)).byteLength;
  }, 0);
  assert.ok(gzipBytes < 100 * 1024, `Fluo initial JavaScript is ${gzipBytes} gzip bytes`);

  const lazyModules = new Set();
  const visitLazy = (key) => {
    if (initialModules.has(key) || lazyModules.has(key)) return;
    const item = manifest[key];
    assert.ok(item, `missing lazy manifest entry for ${key}`);
    lazyModules.add(key);
    for (const dependency of [...(item.imports ?? []), ...(item.dynamicImports ?? [])]) visitLazy(dependency);
  };
  for (const key of initialModules) {
    for (const dependency of manifest[key].dynamicImports ?? []) visitLazy(dependency);
  }
  assert.ok(lazyModules.has('src/lib/FluoDialogs.svelte'), 'Fluo dialogs must load after the initial page');
  for (const library of ['@tiptap+starter-kit@', 'packages/media-client/src/index.ts', 'vidstack@', 'photoswipe@']) {
    assert.ok([...lazyModules].some((dependency) => dependency.includes(library)),
      `${library} must remain outside the initial Fluo JavaScript graph`);
  }
  assert.ok([...initialModules].every((dependency) => !dependency.includes('@tiptap')),
    'Tiptap must remain outside the initial JavaScript graph');

  const playerStyles = Object.entries(manifest).filter(([key]) => key.includes('vidstack/player/styles/default/'));
  assert.equal(playerStyles.length, 2, 'Vidstack theme and video layout styles must be present');
  for (const [, style] of playerStyles) {
    assert.ok(existsSync(join(site, 'fluo', style.file)), `missing lazy Vidstack stylesheet: ${style.file}`);
    assert.ok(!page[1].css?.includes(style.file), `Vidstack stylesheet ${style.file} must load with the video player`);
  }
});
