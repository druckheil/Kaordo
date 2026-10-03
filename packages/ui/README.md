# Kaordo UI

Shared STaSBLR components and Rhea theme. Component source belongs here and is consumed by every app.

Components remain wrappers/compositions of shadcn-svelte/Rhea and Bits UI rather than custom copies of their keyboard/focus behavior. Purpose comments and small helpers explain local style/slot behavior. Shared Bubble, Message, Attachment, Dialog, Context Menu, Dropdown Menu, Avatar, Input and Textarea primitives are consumed by product packages; application queries and access policy belong elsewhere.

Exports are declared by the package entry and subpaths; source consumers keep their dependencies scoped. Reflow, keyboard and axe checks are in the public/product/Regado headless suites and live journey. These checks do not establish full WCAG conformance or user-study scores. See [refactor evidence](../../docs/refactoring.md).
