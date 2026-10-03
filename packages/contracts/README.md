# Kaordo contracts

The OpenAPI document is the source of truth for shared service routes and wire schemas.

Run `pnpm --filter @kaordo/contracts generate` after editing `openapi.yaml`.
This refreshes `src/openapi.d.ts`; do not edit that generated file directly.
App-facing schema aliases are organized in `src/index.ts` and `src/admin.ts`.

No wire schema changed during the maintainability refactor. Regado, Rondo and media use the same generated route contracts; client/helper extraction does not justify app-specific copies. Verify regeneration produces no diff before committing. See [the current review](../../docs/refactoring.md).
