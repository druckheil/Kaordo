import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

const site = resolve(import.meta.dirname, '../dist/pages');
const fluoClient = resolve(import.meta.dirname, '../apps/fluo/.svelte-kit/output/client');
const routes = ['/', '/login/', '/register/', '/ligo/', '/fluo/', '/rondo/', '/regado/'];

function pageAt(route) {
  const file = join(site, route, 'index.html');
  assert.ok(existsSync(file), `missing prerendered page: ${route}`);
  return readFileSync(file, 'utf8');
}

test('every application has a prerendered page and a route home', () => {
  const portal = pageAt('/');
  assert.match(portal, /href="\/fluo\/"/);
  for (const route of ['/rondo/', '/regado/']) {
    assert.match(pageAt(route), /href="\/"/);
  }
  for (const app of ['ligo', 'fluo']) {
    assert.match(pageAt(`/${app}/`), /Checking your account/);
    const source = readFileSync(resolve(import.meta.dirname, `../apps/${app}/src/lib/${app === 'ligo' ? 'LigoApp' : 'FluoApp'}.svelte`), 'utf8');
    assert.match(source, /appPaths\.portal/);
  }
  for (const name of ['Ligo', 'Rondo', 'Regado']) {
    assert.match(portal, new RegExp(name));
  }
  assert.match(portal, /In development/);
});

test('authentication entry points are prerendered without showing guest actions before session resolution', () => {
  const portal = pageAt('/');
  assert.match(portal, /Checking your session/);
  assert.doesNotMatch(portal, /href="\/login\/"/);
  assert.doesNotMatch(portal, /href="\/register\/"/);
  const login = pageAt('/login/');
  const register = pageAt('/register/');
  assert.match(login, /Sign in/);
  assert.match(register, /Join Kaordo/);
  assert.doesNotMatch(login, />Continue to sign in</);
  assert.doesNotMatch(register, />Continue to registration</);
});

test('the static Pages artifact includes the Keycloak silent SSO callback', () => {
  const callback = readFileSync(join(site, 'silent-check-sso.html'), 'utf8');
  assert.match(callback, /parent\.postMessage\(location\.href, location\.origin\)/);
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
  assert.match(readFileSync(resolve(import.meta.dirname, '../apps/fluo/src/lib/Composer.svelte'), 'utf8'), /import\('@tiptap\/core'\)/,
    'The Tiptap editor core must load on demand');

  const playerStyles = Object.entries(manifest).filter(([key]) => key.includes('vidstack/player/styles/default/'));
  assert.equal(playerStyles.length, 2, 'Vidstack theme and video layout styles must be present');
  for (const [, style] of playerStyles) {
    assert.ok(existsSync(join(site, 'fluo', style.file)), `missing lazy Vidstack stylesheet: ${style.file}`);
    assert.ok(!page[1].css?.includes(style.file), `Vidstack stylesheet ${style.file} must load with the video player`);
  }
});
