# SoftUI vendoring record

This directory contains a local, pinned copy of the upstream SoftUI library
so Kaordo does not depend on a CDN or on the upstream repository remaining
available.

- Upstream repository: https://github.com/siddharth-bhansali/softui
- Upstream package: `softui-css` 1.14.2
- Upstream commit: `bb3e6f89cec6c47283390ff853c849b6955988f4`
- Upstream license: MIT (see `LICENSE`)
- The untouched upstream package metadata is preserved in
  `upstream-package.json`.

`src/` and `dist/` retain the upstream CSS, JavaScript, tokens, component
examples, documentation templates, and assets. `dist/softui.kaordo.js` is the
only integration shim: it contains the upstream runtime unchanged and exposes
the returned `SoftUI` controller on `globalThis.SoftUI` so a Svelte adapter can
use the library without relying on a global CDN script.

Do not edit the upstream files directly when adapting Kaordo. Add a small
adapter or a patch beside them and record the reason here so an upstream
refresh remains reviewable.
