# Keycloak

The local Compose profile imports `kaordo-realm.json` into Keycloak 26.7.4. Registration is enabled. `CONFIGURE_TOTP` and `CONFIGURE_RECOVERY_AUTHN_CODES` are default required actions. The browser flow offers TOTP and one-time recovery codes as alternative second factors. The browser client requires PKCE S256, and its access tokens include the `kerno-api` audience. The default `basic` and `profile` scopes supply `sub` and `preferred_username` for Kerno. Password grant and implicit flow are disabled for the browser client.

`registration-profile.json` leaves only Username editable on the registration form. The Kaordo login theme renders one Password input and submits the confirmation value required by Keycloak's built-in password validator. `pnpm dev` applies the registration profile, the web client's `kerno-api` audience mapper and default scopes, the realm password/TOTP policy, required actions, and second-factor browser flow through the local Admin API on every start, including realms imported earlier. If Keycloak is started manually, run `pnpm auth:configure` after it is ready. This reconciles and verifies the settings without deleting existing users and checks an example access token for `aud`, `sub`, and `preferred_username`. Existing access tokens must be refreshed after a scope change before Kerno will accept them.

The `kaordo` login theme inherits Keycloak's supported form templates and applies Deep Purple colors and spacing. Passwords and OTP secrets remain with Keycloak. Keycloak shows recovery codes once after TOTP setup; users must save them. Each recovery code works once. The local profile has no public abuse controls. Startup import skips a realm that already exists; run `pnpm auth:configure` after changing the JSON policy.

The palette in `login/resources/css/deep-purple.css` is generated from `packages/ui/src/lib/themes/deep-purple.css`. Run `node scripts/sync-theme.mjs` after editing the source; `pnpm build:pages` also synchronizes it. Do not maintain a second palette. The native `theme.js` head script uses `kaordo.color-mode` when present and otherwise follows the operating system. It handles changes from other tabs and unavailable storage. Preference sharing requires the same origin, as used in production; the local identity service has its own origin. Hosted forms use the font stack with available system fallbacks; app Fontsource assets belong to the static builds.

The read-only form check can run while local Keycloak is available, without starting the apps or creating a user:

```sh
node --test --test-name-pattern='identity theme' scripts/auth-live.integration.mjs
```

It checks login/registration in both color modes, persisted preference overriding the system, 320px reflow and automated accessibility. The full live journey below additionally exercises credentials, TOTP and recovery.

The local headless authentication test checks the entry, registration, TOTP, recovery, and login states for automatically detectable WCAG A/AA violations with axe-core. This check does not replace keyboard or screen-reader testing.

The sync script now separates policy loading, realm/client reconciliation and effective-token checks. This is a code organization change, not an identity schema or password-policy reset. The browser auth/account packages share initialization and snapshot control. `pnpm test:auth` checks policy and failure cases; `pnpm test:auth:live` checks the real hosted forms and SSO. See [current verification](../../docs/refactoring.md).
