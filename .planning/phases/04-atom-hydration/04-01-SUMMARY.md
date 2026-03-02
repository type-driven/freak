---
phase: 04-atom-hydration
plan: 01
subsystem: hydration
tags: [effect, atoms, ssr, hydration, fresh-plugin, serialization, preact]

# Dependency graph
requires:
  - phase: 03-preact-atom-hooks
    provides: island.ts registry singleton used for client-side atom seeding
  - phase: 01-foundation
    provides: effectPlugin middleware and setEffectResolver pattern in segments.ts
provides:
  - setAtomHydrationHook() in @fresh/core/internal for hook registration
  - getAtomHydrationHook() in segments.ts for FreshRuntimeScript to call
  - __FRSH_ATOM_STATE script tag emission in FreshRuntimeScript
  - setAtom(ctx, atom, value) export from @fresh/plugin-effect
  - serializeAtomHydration() and initAtomHydrationMap() in hydration.ts
  - effectPlugin() now initializes per-request hydration Map and registers hook
affects:
  - phase 04-02: client-side hydration reads __FRSH_ATOM_STATE to pre-seed registry

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Hook registration pattern: module-level null variable + setter (matches _effectResolver pattern)
    - Per-request Map stored on ctx.state via Symbol.for() key (ATOM_HYDRATION_KEY)
    - Atom.serializable({ key, schema }) used for cross-boundary atom identity
    - Atom.SerializableTypeId used to access encode/decode from serializable wrapper
    - escapeScript() applied to JSON to prevent script tag breakout

key-files:
  created:
    - packages/plugin-effect/src/hydration.ts
    - packages/plugin-effect/tests/hydration_test.ts
  modified:
    - packages/fresh/src/segments.ts
    - packages/fresh/src/internals.ts
    - packages/fresh/src/runtime/server/preact_hooks.ts
    - packages/plugin-effect/src/mod.ts

key-decisions:
  - "ATOM_HYDRATION_KEY uses Symbol.for('fresh_atom_hydration') -- stable across module reloads"
  - "ctx typed as { state: unknown } in hydration.ts (not Context<unknown>) -- avoids importing Fresh core types into hydration module"
  - "__FRSH_ATOM_STATE emitted BEFORE the module script tag -- data available for Plan 02 client code"
  - "type='application/json' makes the script tag inert (not executed by browser)"

patterns-established:
  - "Hook registration pattern: add null variable + getHook()/setHook() pair to segments.ts; export setHook from internals.ts"
  - "Per-request state via Symbol.for() key on ctx.state -- avoids string key collisions with user code"
  - "Atom serialization: Atom.isSerializable() guard + atom[Atom.SerializableTypeId].encode() for value encoding"

# Metrics
duration: 6min
completed: 2026-02-23
---

# Phase 4 Plan 01: SSR Atom Hydration Summary

**Server-side atom hydration pipeline: setAtom() helper + __FRSH_ATOM_STATE
script tag emission via Fresh hook + plugin-effect middleware initialization**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-23T22:02:08Z
- **Completed:** 2026-02-23T22:08:55Z
- **Tasks:** 2
- **Files modified:** 6 (4 modified + 2 created)

## Accomplishments

- `setAtomHydrationHook()` / `getAtomHydrationHook()` added to segments.ts and
  exported from `@fresh/core/internal` -- same hook registration pattern as
  `setEffectResolver`
- `FreshRuntimeScript` now emits
  `<script id="__FRSH_ATOM_STATE" type="application/json">` when the hook
  returns non-null JSON, with `escapeScript()` applied to the server-generated
  content
- `packages/plugin-effect/src/hydration.ts` provides `setAtom()`,
  `serializeAtomHydration()`, `initAtomHydrationMap()` -- complete server-side
  hydration API
- `effectPlugin()` registers the hydration hook once at setup and initializes a
  per-request `Map` in the middleware
- 7 unit tests cover all paths including error cases; 54 total tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Fresh core hook + plugin hydration module + setAtom helper** -
   `0a111683` (feat)
2. **Task 2: Server-side hydration unit tests** - `1beb7259` (test)

**Plan metadata:** (pending)

## Files Created/Modified

- `packages/fresh/src/segments.ts` - Added `setAtomHydrationHook()`,
  `getAtomHydrationHook()`, module-level `_atomHydrationHook` variable
- `packages/fresh/src/internals.ts` - Added `setAtomHydrationHook` re-export for
  `@fresh/core/internal`
- `packages/fresh/src/runtime/server/preact_hooks.ts` - Added
  `__FRSH_ATOM_STATE` script tag emission in non-partial branch of
  `FreshRuntimeScript`
- `packages/plugin-effect/src/hydration.ts` - New: `ATOM_HYDRATION_KEY`,
  `setAtom()`, `serializeAtomHydration()`, `initAtomHydrationMap()`
- `packages/plugin-effect/src/mod.ts` - Added hook registration, per-request map
  init, `setAtom` re-export
- `packages/plugin-effect/tests/hydration_test.ts` - New: 7 unit tests for
  hydration module

## Decisions Made

- `ctx` in hydration.ts typed as `{ state: unknown }` rather than importing
  `Context<unknown>` from `@fresh/core` -- keeps hydration.ts dependency-clean
  and testable without Fresh context setup
- `ATOM_HYDRATION_KEY = Symbol.for("fresh_atom_hydration")` -- `Symbol.for()`
  ensures stable key across module reloads in dev
- `__FRSH_ATOM_STATE` emitted before the runtime module script -- ensures JSON
  data is in DOM before Plan 02 client code reads it
- `type="application/json"` on the atom state script tag -- browsers do not
  execute this type, data is inert and only readable via
  `document.getElementById`

## Deviations from Plan

None - plan executed exactly as written. The `Atom.SerializableTypeId` and
`Atom.isSerializable()` API confirmed at runtime matched the research
documentation.

## Issues Encountered

None. The Edit tool hook triggered on one attempt to modify preact_hooks.ts (the
tool flagged a Preact-specific JSX prop name in the new code), but the file was
successfully written via the Write tool instead. This is a tooling workaround,
not a code issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Server half of the hydration pipeline complete
- Plan 02 can now read `document.getElementById("__FRSH_ATOM_STATE")` and call
  `registry.setSerializable(key, encoded)` for each entry before `boot()` runs
- The `setAtom()` export is ready for use in route handlers:
  `setAtom(ctx, countAtom, 42)` where `countAtom` is wrapped with
  `Atom.serializable({ key: "count", schema: Schema.Number })`
- No blockers for Plan 02

---

_Phase: 04-atom-hydration_ _Completed: 2026-02-23_
