# Phase 2: Type-Safe API - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `createEffectDefine()` — a typed wrapper that threads Layer service requirements (`R`)
through route handler type signatures. Using a service not provided by the configured Layer
is a TypeScript compile error at the handler definition site.

This phase does NOT change runtime behavior — `effectPlugin()` still handles all Effect
execution. `createEffectDefine()` is purely a compile-time convenience layer on top.

</domain>

<decisions>
## Implementation Decisions

### API shape
- **Claude's discretion** on whether it returns a full define object or a handler-wrapper
  function — whatever integrates most naturally with Fresh's existing define pattern
- Lives in `@fresh/plugin-effect` (same package as `effectPlugin`) — maintains the
  no-npm:effect-in-@fresh/core constraint
- State type threading: Claude's discretion — whatever gives best inference with least friction
- **Convenience layer, not primary API** — plain `Effect.succeed()` returns still work without
  `createEffectDefine()`. This is opt-in for when compile-time `R` enforcement is wanted.

### Error type threading
- **E type threading**: Claude's discretion — whatever gives the most useful developer
  experience without overcomplicating the signature (lean toward omitting E if it adds
  noise without value)
- **Error location**: Claude's discretion — wherever TypeScript naturally surfaces the
  constraint violation (handler body or route export)
- **R constraint strictness**: Claude's discretion — whatever TypeScript allows naturally
  with the generic constraints

### Layer binding
- **Standalone capable** — `createEffectDefine()` can create its own `ManagedRuntime` when
  a Layer is provided, so `effectPlugin()` is not required when using the define
- **Runtime ownership**: Claude's discretion — avoid surprising state collisions between
  `createEffectDefine()`'s runtime and any `effectPlugin()` runtime; clean solution preferred
- Type-parameter-only path: `createEffectDefine<State, R>()` (no Layer value) is also
  valid when `effectPlugin()` is already handling runtime

### Non-Effect handler interop
- **Primary use case**: API endpoint style — POST/GET returning `Response` (or `PageResponse`)
  via Effect that reads from Layer services. Lean toward ergonomic for this pattern.
- **Mixing**: Claude's discretion — whatever the TypeScript signature naturally supports
  for accepting both Effect-returning and plain async handlers from the same define

### Claude's Discretion
- Full API shape (define object vs handler-wrapper function)
- State type parameter inclusion and placement
- Whether E threads through or stays as unknown
- Where TypeScript surfaces the R constraint violation
- How createEffectDefine()'s runtime interacts with effectPlugin()'s runtime
- Whether plain and Effect handlers can mix in the same define

</decisions>

<specifics>
## Specific Ideas

- The mental model is: "effectPlugin() wires up runtime globally; createEffectDefine() adds
  R-constraint enforcement per-route for when you want compile-time safety"
- Primary use case is API endpoints — POST/GET handlers that yield Layer services inside
  Effect.gen and return Response or PageResponse

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-type-safe-api*
*Context gathered: 2026-02-18*
