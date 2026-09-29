import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const site = resolve(import.meta.dirname, '../dist/pages');
const routes = ['/', '/login/', '/register/', '/ligo/', '/fluo/', '/rondo/', '/regado/'];

function pageAt(route) {
  const file = join(site, route, 'index.html');
  assert.ok(existsSync(file), `missing prerendered page: ${route}`);
  return readFileSync(file, 'utf8');
}

test('every application has a prerendered page and a route home', () => {
  const portal = pageAt('/');
  for (const route of ['/ligo/', '/fluo/', '/rondo/', '/regado/']) {
    assert.match(portal, new RegExp(`href="${route}"`));
    assert.match(pageAt(route), /href="\/"/);
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
  assert.match(register, /Create your account/);
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
