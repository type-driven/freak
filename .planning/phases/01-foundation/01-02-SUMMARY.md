---
phase: 01-foundation
plan: 02
subsystem: api
tags: [effect, fresh, deno, typescript, managed-runtime, middleware, plugin]

# Dependency graph
requires:
  - phase: 01-01
    provides: "setEffectResolver() hook in @fresh/core/internal and EffectLike duck-type in @fresh/core"
provides:
  - effectPlugin() function that creates ManagedRuntime and wires Effect v4 into Fresh
  - isEffect() duck-type detector using v4 TypeId string "~effect/Effect"
  - createResolver() callback factory that runs Effects via runPromiseExit
  - makeRuntime() singleton factory wrapping ManagedRuntime.make()
  - registerDisposal() cleanup hook via globalThis unload event
  - ctx.state.effectRuntime attachment in middleware per-request
affects:
  - 01-03 (error dispatch refinement builds on this plugin)
  - All phases using Effect in route handlers

# Tech tracking
tech-stack:
  added:
    - npm:effect@4.0.0-beta.0
  patterns:
    - ManagedRuntime singleton at plugin setup time (not per-request)
    - Duck-typed Effect detection via string key "~effect/Effect" (v4 TypeId)
    - Fresh plugin = setup function returning middleware closure
    - globalThis unload event for ManagedRuntime disposal (no lifecycle hooks in Fresh)

key-files:
  created:
    - packages/plugin-effect/deno.json
    - packages/plugin-effect/src/mod.ts
    - packages/plugin-effect/src/resolver.ts
    - packages/plugin-effect/src/runtime.ts
    - packages/plugin-effect/src/types.ts
  modified: []

key-decisions:
  - "Use deno-lint-ignore no-explicit-any for ManagedRuntime<any, any> in createResolver — R/E generics erased at resolver boundary; type safety enforced at effectPlugin call site"
  - "Removed duplicate EffectPluginOptions re-export — interface already exported via declaration; extra re-export causes TS2484"
  - "Layer.empty as default for zero-config path — effectPlugin() with no arguments still creates a functional ManagedRuntime"

patterns-established:
  - "effectPlugin() pattern: create singleton runtime, call setEffectResolver, register disposal, return middleware closure"
  - "resolver pass-through: non-Effect values returned unchanged — resolver is transparent to plain Response/PageResponse handlers"

# Metrics
duration: 2min
completed: 2026-02-18
---

# Phase 1 Plan 2: Effect Plugin Package Summary

**ManagedRuntime singleton wired into Fresh via effectPlugin() — Effect v4
handlers auto-detected by "~effect/Effect" TypeId and run via runPromiseExit
with ctx.state.effectRuntime attachment**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-18T22:36:27Z
- **Completed:** 2026-02-18T22:38:30Z
- **Tasks:** 2
- **Files modified:** 5 (all created)

## Accomplishments

- `packages/plugin-effect/` package created with all 4 source modules (mod.ts,
  resolver.ts, runtime.ts, types.ts)
- `effectPlugin()` creates ManagedRuntime once at setup time from provided Layer
  or Layer.empty
- `setEffectResolver()` called at setup time to wire resolver into Fresh core's
  renderRoute dispatch
- `isEffect()` duck-type check uses v4 TypeId string `"~effect/Effect"`
  (verified against effect@4.0.0-beta.0)
- `createResolver()` returns pass-through for non-Effect values; runs Effects
  via `runPromiseExit`, returning `exit.value` on success
- ManagedRuntime disposed via `globalThis.addEventListener("unload", ...)` at
  plugin setup time
- `npm:effect@4.0.0-beta.0` installed via `deno install` with workspace
  nodeModulesDir:manual config

## Task Commits

Each task was committed atomically:

1. **Task 1: Create plugin-effect package scaffold with deno.json and
   type/runtime modules** - `93db3feb` (feat)
2. **Task 2: Implement effectPlugin() middleware that wires everything
   together** - `e66d5629` (feat)

## Files Created/Modified

- `packages/plugin-effect/deno.json` - Package config: @fresh/plugin-effect
  v0.1.0, npm:effect@4.0.0-beta.0, @fresh/core JSR imports
- `packages/plugin-effect/src/types.ts` - Re-exports Layer and ManagedRuntime
  types from effect for user convenience
- `packages/plugin-effect/src/runtime.ts` - makeRuntime() wrapping
  ManagedRuntime.make(); registerDisposal() on globalThis unload
- `packages/plugin-effect/src/resolver.ts` - isEffect() detector +
  createResolver() callback factory using runPromiseExit
- `packages/plugin-effect/src/mod.ts` - effectPlugin() integrating all modules;
  exports effectPlugin, EffectPluginOptions, isEffect, Layer, ManagedRuntime

## Decisions Made

- Used `deno-lint-ignore no-explicit-any` for `ManagedRuntime<any, any>` in
  `createResolver` — R and E generics are erased at the resolver callback
  boundary (signature is `(unknown, unknown) => Promise<unknown>`). Type safety
  is enforced at the `effectPlugin()` call site where the generic Layer type is
  known.
- Removed duplicate `export type { EffectPluginOptions }` re-export at the
  bottom of mod.ts — the interface declaration already exports it; the re-export
  caused TS2484 "conflicts with exported declaration". Removed the redundant
  line.
- Layer.empty used as the default layer when no `layer` option is provided —
  ensures zero-config `effectPlugin()` creates a functional (though
  service-free) ManagedRuntime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate export of EffectPluginOptions caused TS2484**

- **Found during:** Task 2 (type check of mod.ts)
- **Issue:** The plan template included both
  `export interface EffectPluginOptions` (inline declaration export) and
  `export type { EffectPluginOptions }` (re-export at bottom of file).
  TypeScript raises TS2484 "Export declaration conflicts with exported
  declaration" for this pattern.
- **Fix:** Removed the redundant `export type { EffectPluginOptions }` re-export
  line at the bottom of mod.ts; the interface is already exported via its
  declaration.
- **Files modified:** `packages/plugin-effect/src/mod.ts`
- **Verification:** `deno check packages/plugin-effect/src/mod.ts` passes after
  removal.
- **Committed in:** `e66d5629` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 TypeScript duplicate export bug from plan
template) **Impact on plan:** The fix is a trivial one-line removal; no
behavioral change, no scope creep. The exported type surface is identical to
what the plan specified.

## Issues Encountered

The `nodeModulesDir: "manual"` workspace configuration required running
`deno install` after creating `packages/plugin-effect/deno.json` to make
`npm:effect@4.0.0-beta.0` available for type checking. This is the expected
workflow for this repository — not an issue, just the standard Deno workspace
procedure.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `effectPlugin()` is ready to use: `app.use(effectPlugin())` or
  `app.use(effectPlugin({ layer: AppLayer }))`
- Route handlers can now return `Effect.Effect<Response>` values — they will be
  detected by `isEffect()`, run via `ManagedRuntime.runPromiseExit`, and their
  success value returned to Fresh's response pipeline
- Plan 01-03 can refine error dispatch (Cause-to-Response mapping, typed errors)
  building on the `mapError` option already exposed in `EffectPluginOptions`
- No blockers for Plan 01-03

---

_Phase: 01-foundation_ _Completed: 2026-02-18_
