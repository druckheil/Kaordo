# Kaordo

Independent SvelteKit entry application with sign-in, registration and the public `/agordoj/` appearance route. The credential and TOTP forms are hosted by Keycloak; the portal uses OIDC Authorization Code with PKCE through `@kaordo/auth`.

`AuthScreen` immediately replaces the login/registration entry route with the hosted identity form. It uses Keycloak's URL builders without first running a passive SSO check. There is no welcome/confirmation form or history flag that can strand navigation on an intermediate screen. A shared header and brief loading status cover navigation; retry controls appear only when opening the form fails. Requests completing after route teardown cannot navigate the browser.

Keycloak owns its native login controls and browser flow. Its inherited login template supplies the login inputs; `register.ftl` uses the supported Keycloak profile helpers and exposes only Username and Password. Those HTML controls are styled with the shared appearance tokens, native labels and validity attributes. Password visibility and password-confirmation submission remain integrated with Keycloak's form behavior; credentials never pass through an app-owned field or API. Bits UI is reserved for interactive primitives that need its behavior, so plain credential inputs do not receive a needless combobox/form wrapper.

The entry URL carries the currently selected theme and preferred mode through `withIdentityAppearance`. The native theme script validates and applies them before paint, persists them on the identity origin and removes the appearance parameters. This also works locally, where the static app and Keycloak use different ports and therefore cannot share local storage. Error, registration and second-factor forms retain that same choice.

The combined static development build is assembled by `pnpm build:pages` and reads browser settings from the repository root `.env`. Use `pnpm build:pages:production` for deployment; it forces the configured public HTTPS origin for Keycloak, Kerno, and Nodo.

## Code organization

Agordoj uses the shared `ThemePicker` and rightmost `AgordojLink` header control. Its seven theme choices apply immediately and persist per browser origin through `mode-watcher`; Deep Purple is the default. It requires no account or backend request. The light/dark toggle remains independent of the palette choice.

The route composes `PortalWelcome`, `PortalApps` and `AuthScreen`; `portal-model` defines public app entries and heading derivations. Regado is deliberately absent from the app list. Authentication/account snapshot handling belongs to `auth` and `account-ui`, including the presentation-only preview during revalidation. No app copies the token/session controller.

Check with `pnpm check:front`, `pnpm test:auth`, public headless checks and the live identity journey. See [refactor evidence](../../docs/refactoring.md).
