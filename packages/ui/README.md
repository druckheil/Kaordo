# Kaordo UI

Shared STaSBRL components: Svelte/SvelteKit, Tailwind CSS, shadcn-svelte, Bits UI, Rhea and Lucide. Component source belongs here and is consumed by every app.

Components remain wrappers/compositions of shadcn-svelte/Rhea and Bits UI rather than custom copies of their keyboard/focus behavior. Purpose comments and small helpers explain local style/slot behavior. Shared Bubble, Message, Attachment, Dialog, Context Menu, Dropdown Menu, Avatar, Input and Textarea primitives are consumed by product packages; application queries and access policy belong elsewhere.

## Deep Purple

`themes/deep-purple.css` owns the single light/dark semantic palette, fonts, radii and shadows. Tailwind utilities and Rhea components consume those tokens through `styles.css`. Plus Jakarta Sans and JetBrains Mono are bundled through Fontsource; Inter supplies additional glyph coverage. There are no external font requests.

Every app mounts `ThemeProvider` in its root layout. It uses the shadcn-svelte recommended `mode-watcher` package to apply the mode in the HTML head before hydration, follow the operating system until an explicit choice, and synchronize preferences across tabs. `ThemeToggle` composes the shared Button and Lucide sun/moon icons in the top-right header; its pressed state exposes whether dark mode is active. Transitions respect reduced-motion settings.

The browser stores `kaordo.color-mode` and `kaordo.theme` per origin. Navigation and reload preserve the selected mode. The supplied Deep Purple palette has small contrast adjustments to light muted/destructive text and dark primary/accent text; these improve readability on tinted surfaces. Semantic warning/success colors remain distinct from the brand palette.

`node scripts/sync-theme.mjs` copies the canonical palette into the separately served Keycloak theme. The root Pages build runs this automatically. Keycloak's small native head script reads the same mode preference; the production identity forms and apps share one origin. See [identity theme](../../deploy/keycloak/README.md).

Exports are declared by the package entry and subpaths; source consumers keep their dependencies scoped. Reflow, keyboard and axe checks are in the public/product/Regado headless suites and live journey. These checks do not establish full WCAG conformance or user-study scores. See [refactor evidence](../../docs/refactoring.md).
