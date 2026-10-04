// Verifies local and public endpoint selection for static builds
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuildEnvironment } from './build-pages-config.mjs';

test('local page builds preserve the selected development services', () => {
  const environment = {
    VITE_KAORDO_AUTH_URL: 'http://localhost:8080',
    VITE_KAORDO_API_URL: 'http://localhost:8081',
    VITE_KAORDO_NODO_URL: 'http://127.0.0.1:8082'
  };

  assert.equal(createBuildEnvironment(false, environment), environment);
});

test('production page builds replace local service URLs with public same-origin endpoints', () => {
  const environment = createBuildEnvironment(true, {
    KAORDO_PUBLIC_ORIGIN: 'https://social.example',
    VITE_KAORDO_AUTH_URL: 'http://localhost:8080',
    VITE_KAORDO_API_URL: 'http://localhost:8081',
    VITE_KAORDO_NODO_URL: 'http://127.0.0.1:8082'
  });

  assert.equal(environment.VITE_KAORDO_AUTH_URL, 'https://social.example');
  assert.equal(environment.VITE_KAORDO_AUTH_REALM, 'kaordo');
  assert.equal(environment.VITE_KAORDO_AUTH_CLIENT_ID, 'kaordo-web');
  assert.equal(environment.VITE_KAORDO_API_URL, 'https://social.example');
  assert.equal(environment.VITE_KAORDO_NODO_URL, 'https://social.example');
});

test('production page builds reject insecure or non-origin URLs', () => {
  for (const origin of ['http://kaordo.link', 'https://kaordo.link/path', 'https://user@kaordo.link']) {
    assert.throws(
      () => createBuildEnvironment(true, { KAORDO_PUBLIC_ORIGIN: origin }),
      /must be a plain HTTPS origin/
    );
  }
});
