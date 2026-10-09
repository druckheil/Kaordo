# Keycloak

- `kaordo-realm.json` is the local realm, imported into an empty identity database. Production uses `deploy/nixos/kaordo-realm.json`.
- `registration-profile.json` leaves only Username editable at registration.
- `themes/kaordo/login` is the hosted-form theme. Its palettes and head script are generated from `packages/ui/src/lib/themes` by `node scripts/sync-theme.mjs`. Do not edit the generated files by hand.

Import skips an existing realm, so policy is reconciled through the Admin API: `scripts/sync-keycloak.mjs` locally (run by `pnpm dev` and `pnpm auth:configure`) and `deploy/nixos/sync-keycloak-production.mjs` in production. Both scripts apply:

- the registration profile;
- required TOTP and recovery codes, and the second-factor browser flow;
- password and OTP policy;
- 30-day idle and five-year maximum sessions, five-minute access tokens and rotating refresh tokens;
- the `basic` and `profile` default scopes and the `kerno-api` audience mapper.

They then read the effective policy back. When a user exists they also verify an issued access token's `aud`, `sub` and `preferred_username`. Existing users and credentials are never deleted.

App sign-in links carry `kaordo_theme` and `kaordo_mode`. The theme script applies them before paint, saves them on the identity origin and strips them from the URL, so hosted forms match the app's appearance across origins.

Focused checks against a local Keycloak, without starting the apps:

```sh
pnpm exec playwright test --project=live auth-live.integration.mjs --grep 'identity (theme|OTP)'
```
