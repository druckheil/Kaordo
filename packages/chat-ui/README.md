# Kaordo chat UI

Shared message presentation and composing for Ligo and Rondo. `MessageComposer` handles the draft, eight-attachment limit, file previews, Enter/Shift+Enter and textarea growth. It calls the parent send action; uploading, persistence and cache updates belong to shared clients/app controllers.

`MessageList` owns native scroll lifecycle: initial bottom alignment, following the newest message near the end and visible-message anchoring during older-history insertion. It does not virtualize rows or intercept wheel gestures. `MessageBubble` composes STaSBLR Bubble, Message, Attachment and menus, showing reactions/time/status inside or next to compact content. Formatting/grouping helpers hide repeated group authors and all duo authors. Media uses the shared compact grid, without Fluo's carousel.

Import heavy views through package subpaths where lazy loading is needed. Test with `pnpm test:ui-layout`, `pnpm test:product:ui` and the live journey. Native macOS rubber-band behavior still requires hardware/browser validation beyond Chromium wheel tests. See [refactor evidence](../../docs/refactoring.md).
