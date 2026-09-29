import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const site = resolve(import.meta.dirname, '../dist/pages');
const routes = ['/', '/ligo/', '/fluo/', '/rondo/', '/regado/'];

function pageAt(route) {
  const file = join(site, route, 'index.html');
  assert.ok(existsSync(file), `missing prerendered page: ${route}`);
  return readFileSync(file, 'utf8');
}

test('every application has a prerendered page and a route home', () => {
  const portal = pageAt('/');
  for (const route of routes.slice(1)) {
    assert.match(portal, new RegExp(`href="${route}"`));
    assert.match(pageAt(route), /href="\/"/);
  }
});

test('all local HTML asset references exist in the Pages artifact', () => {
  for (const route of routes) {
    const html = pageAt(route);
    for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (!reference.startsWith('./') && !reference.startsWith('/')) continue;
      const target = reference.startsWith('/') ? reference : `${route}${reference.slice(2)}`;
      assert.ok(existsSync(join(site, target)), `${route} references missing ${reference}`);
    }
  }
});
