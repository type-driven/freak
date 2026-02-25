---
phase: 06-fresh-core-plumbing
plan: "01"
subsystem: core
tags: [fresh, effect, typescript, deno, middleware, per-app-runner]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: EffectLike structural type, original setEffectResolver hook
  - phase: 05-example
    provides: plugin-effect integration tests that must remain green
provides:
  - Per-app EffectRunner field on App<State> (not module global)
  - setEffectRunner(app, fn) / getEffectRunner(app) exported from internals.ts
  - isEffectLike(value) exported from handlers.ts and internals.ts
  - EffectRunner type defined in handlers.ts (no circular deps)
  - renderRoute and runMiddlewares accept optional effectRunner param
  - applyCommands/applyCommandsInner thread effectRunner through all dispatch paths
affects:
  - 07-effect-package
  - 08-httpapi-integration
  - 09-rpc-integration

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-app private field pattern: declare export let fn outside class, assign in static{} block"
    - "EffectRunner type lives in handlers.ts to avoid circular import via app.ts->commands.ts->segments.ts"
    - "effectRunner threaded as optional parameter through applyCommands->applyCommandsInner->renderRoute/segmentToMiddlewares"
    - "isEffectLike duck-types on '~effect/Effect' TypeId string (Effect v4)"

key-files:
  created: []
  modified:
    - packages/fresh/src/handlers.ts
    - packages/fresh/src/app.ts
    - packages/fresh/src/segments.ts
    - packages/fresh/src/middlewares/mod.ts
    - packages/fresh/src/commands.ts
    - packages/fresh/src/internals.ts
    - packages/fresh/src/mod.ts

key-decisions:
  - "EffectRunner type defined in handlers.ts (not app.ts) to avoid circular import: app.ts->commands.ts->segments.ts->app.ts"
  - "commands.ts updated (not just app.ts) to thread effectRunner through renderRoute closures"
  - "isEffectLike and EffectRunner added to public mod.ts API for Phase 7 EffectApp use"

patterns-established:
  - "App<State> private fields pattern: declare `export let fn` above class, assign in static{} block"
  - "EffectRunner optional param pattern: effectRunner?: EffectRunner | null at each call boundary"

# Metrics
duration: 6min
completed: 2026-02-25
---

# Phase 6 Plan 01: Per-app Effect Runner Summary

**Replaced module-global `_effectResolver` singleton with per-app `App<State>#effectRunner` private field, threaded through all dispatch paths (renderRoute, runMiddlewares, applyCommandsInner)**

## Performance

- **Duration:** 6 min 19s
- **Started:** 2026-02-25T18:03:13Z
- **Completed:** 2026-02-25T18:09:32Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `_effectResolver` module global eliminated from `segments.ts`; `setEffectResolver` removed from `internals.ts`
- `App<State>` gains `#effectRunner: EffectRunner | null` private field using the established static-block pattern
- `setEffectRunner(app, fn)` and `getEffectRunner(app)` exported from `app.ts` and re-exported from `internals.ts`
- `isEffectLike(value)` function added to `handlers.ts` — duck-types on `"~effect/Effect"` TypeId
- `EffectRunner` type defined in `handlers.ts` (avoids circular deps through `app.ts -> commands.ts -> segments.ts`)
- `renderRoute` and `segmentToMiddlewares` in `segments.ts` accept optional `effectRunner` parameter
- `runMiddlewares` in `middlewares/mod.ts` accepts optional `effectRunner` and detects Effects via `isEffectLike`
- `applyCommands` / `applyCommandsInner` in `commands.ts` thread `effectRunner` through all `renderRoute` and `segmentToMiddlewares` calls

## Task Commits

Each task was committed atomically:

1. **Task 1: Export isEffectLike from handlers.ts** - `b201e0d8` (feat)
2. **Task 2: Per-app #effectRunner + thread through all dispatch paths** - `07573be6` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `packages/fresh/src/handlers.ts` - Added `EffectRunner` type and `isEffectLike()` function
- `packages/fresh/src/app.ts` - Added `#effectRunner` field, `setEffectRunner`/`getEffectRunner` static-block wiring, import from handlers.ts
- `packages/fresh/src/segments.ts` - Removed `_effectResolver`/`setEffectResolver`; updated `renderRoute` and `segmentToMiddlewares` signatures; import `EffectRunner`/`isEffectLike` from handlers.ts
- `packages/fresh/src/middlewares/mod.ts` - Added `effectRunner` param to `runMiddlewares`; Effect detection via `isEffectLike`
- `packages/fresh/src/commands.ts` - Added `EffectRunner` import; threaded `effectRunner` through `applyCommands`, `applyCommandsInner`, all `renderRoute`/`segmentToMiddlewares` call sites, and `FsRoute` recursion
- `packages/fresh/src/internals.ts` - Removed `setEffectResolver` export; added `setEffectRunner`/`getEffectRunner`/`isEffectLike`/`EffectRunner` exports
- `packages/fresh/src/mod.ts` - Added `isEffectLike` and `EffectRunner` to public API

## Decisions Made

- **EffectRunner type in handlers.ts**: The plan suggested `app.ts` as home, but `app.ts -> commands.ts -> segments.ts` would create a circular import if `segments.ts` imported from `app.ts`. Defined in `handlers.ts` instead (no circular risk), re-exported from `app.ts` for API stability.
- **commands.ts update**: The plan assumed `applyCommandsInner` was in `App.handler()`. It's actually in `commands.ts`. Updated `applyCommands`/`applyCommandsInner` to accept and thread `effectRunner` — this is the only way to pass it to the `renderRoute` closures.
- **isEffectLike / EffectRunner in public mod.ts**: Added both for Phase 7's `EffectApp` usage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] commands.ts required effectRunner threading**

- **Found during:** Task 2 (thread effectRunner through dispatch paths)
- **Issue:** Plan assumed `applyCommandsInner` was inside `App.handler()`. It's actually in `commands.ts`. The `renderRoute` closures inside `CommandType.Route` have no access to `this.#effectRunner` unless threaded through `applyCommands`/`applyCommandsInner`.
- **Fix:** Added `EffectRunner` import and optional `effectRunner` parameter to `applyCommands`, `applyCommandsInner`, and all internal call sites (`renderRoute`, `segmentToMiddlewares`, recursive `FsRoute` call).
- **Files modified:** `packages/fresh/src/commands.ts`
- **Verification:** `deno check` passes; effectRunner now reaches all `renderRoute` invocations.
- **Committed in:** `07573be6` (Task 2 commit)

**2. [Rule 3 - Blocking] EffectRunner type moved to handlers.ts to prevent circular import**

- **Found during:** Task 2 (Step C — updating segments.ts)
- **Issue:** Plan suggested defining `EffectRunner` in `app.ts`. But `segments.ts` importing from `app.ts` creates a circular dependency: `app.ts -> commands.ts -> segments.ts -> app.ts`.
- **Fix:** Defined `EffectRunner` in `handlers.ts` (which has no circular risk). `app.ts` imports it from there; `segments.ts` also imports from `handlers.ts`.
- **Files modified:** `packages/fresh/src/handlers.ts`, `packages/fresh/src/app.ts`
- **Verification:** No circular import errors; `deno check` clean.
- **Committed in:** `07573be6` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for correct implementation. No scope creep — purely structural adjustments to match the actual codebase layout.

## Issues Encountered

- Pre-existing test failures (51 tests) in `packages/fresh/` due to missing `--allow-env` Deno permissions. Confirmed pre-existing by checking with `git stash`/`pop`. Not caused by these changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CORE-01, CORE-02, CORE-03 infrastructure is in place: `App<State>` owns its runner, all dispatch paths check for Effects
- Phase 7 (`@fresh/effect` package) can use `setEffectRunner(app, fn)` via `@fresh/core/internal` to register a per-app Effect runtime
- `plugin-effect` uses the removed `setEffectResolver` — it will need updating in Phase 7 (compat shim plan)
- Concern: `plugin-effect` package currently broken (import of removed `setEffectResolver`). Phase 7 plan should address this.

---
*Phase: 06-fresh-core-plumbing*
*Completed: 2026-02-25*
