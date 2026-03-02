---
phase: 06-fresh-core-plumbing
plan: "02"
subsystem: testing
tags: [effect, plugin-effect, setEffectRunner, per-app-isolation, deno-fresh]

# Dependency graph
requires:
  - phase: 06-01
    provides: "setEffectRunner(app, runner) API, #effectRunner per-app field on App, isEffectLike exported"
provides:
  - "effectPlugin(app, opts) updated to call setEffectRunner instead of setEffectResolver"
  - "createEffectDefine(app, { layer }) updated to call setEffectRunner instead of setEffectResolver"
  - "integration_test.ts updated to new effectPlugin(app, opts) signature — all 7 tests green"
  - "per_app_test.ts: 6 tests covering SC-1 isolation, SC-2 app.get() dispatch, SC-3 app.use() middleware"
affects:
  - "07-effect-package: effectPlugin compat shim will re-export from @fresh/effect using setEffectRunner pattern"
  - "10-migration-example: migration docs reference new effectPlugin(app, opts) call signature"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "effectPlugin(app, opts) — app-first argument enables per-app runner registration"
    - "createEffectDefine(app, { layer }) — app-first argument enables per-app runner registration"
    - "EffectRunner wraps createResolver output for setEffectRunner API"
    - "Type cast pattern (as unknown as Response) for Effect returns from app.get()/app.use() — runtime dispatch works despite type gap"

key-files:
  created:
    - "packages/plugin-effect/tests/per_app_test.ts"
  modified:
    - "packages/plugin-effect/src/mod.ts"
    - "packages/plugin-effect/src/define.ts"
    - "packages/plugin-effect/src/resolver.ts"
    - "packages/plugin-effect/tests/integration_test.ts"
    - "packages/plugin-effect/tests/plugin_test.ts"
    - "packages/plugin-effect/tests/define_test.ts"

key-decisions:
  - "effectPlugin signature changed from effectPlugin(opts?) to effectPlugin(app, opts?) — app-first enables per-app runner registration without global state"
  - "createEffectDefine standalone path now requires app as first argument — throws error if layer provided without app"
  - "Type casts used in per_app_test.ts for SC-2/SC-3 — app.get()/app.use() types don't include EffectLike; runtime dispatch works, type-level support is Phase 7"

patterns-established:
  - "Plugin-to-app wiring: plugins that need per-app isolation accept app as first argument"
  - "Resolver-to-runner bridge: createResolver() output wrapped as EffectRunner for setEffectRunner API"

# Metrics
duration: 6min
completed: 2026-02-25
---

# Phase 6 Plan 02: Update plugin-effect + per-app isolation tests Summary

**effectPlugin(app, opts) updated from setEffectResolver to setEffectRunner; 13
tests covering per-app isolation, app.get() Effect dispatch, and app.use()
Effect middleware all green**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-25T18:13:49Z
- **Completed:** 2026-02-25T18:19:37Z
- **Tasks:** 2
- **Files modified:** 7 (6 modified, 1 created)

## Accomplishments

- Replaced `setEffectResolver(resolver)` global call with
  `setEffectRunner(app, runner)` per-app call in `effectPlugin()` and
  `createEffectDefine()`
- All 7 existing integration tests remain green after signature update
- New `per_app_test.ts` verifies all Phase 6 success criteria: SC-1 isolation (2
  tests), SC-2 app.get() dispatch (2 tests), SC-3 app.use() middleware (2 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update effectPlugin() to use setEffectRunner** - `32f5645f` (feat)
2. **Task 2: Write per_app_test.ts: all four success criteria** - `49d43e27`
   (test)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `packages/plugin-effect/src/mod.ts` — effectPlugin(app, opts) replaces
  setEffectResolver with setEffectRunner(app, runner)
- `packages/plugin-effect/src/define.ts` — createEffectDefine(app?, opts)
  replaces setEffectResolver with setEffectRunner(app, runner); requires app
  when layer provided
- `packages/plugin-effect/src/resolver.ts` — doc comment updated
  (setEffectResolver -> setEffectRunner)
- `packages/plugin-effect/tests/integration_test.ts` — updated to
  effectPlugin(app) call signature; all tests use `new App()` +
  `effectPlugin(app)` pattern
- `packages/plugin-effect/tests/plugin_test.ts` — updated to effectPlugin(app)
  call signature
- `packages/plugin-effect/tests/define_test.ts` — updated to
  createEffectDefine(app, { layer }) call signature
- `packages/plugin-effect/tests/per_app_test.ts` — NEW: 6 tests for
  SC-1/SC-2/SC-3/SC-4

## Decisions Made

- `effectPlugin` signature changed to `effectPlugin(app, opts?)` — breaking
  change to call sites, but necessary for per-app isolation. Documented in plan
  as acceptable since test _assertions_ unchanged.
- `createEffectDefine` standalone path now requires `app` as first arg when
  `layer` is provided — throws descriptive error if called without app. No-app
  path (type-only) unchanged.
- Type casts (`as unknown as Response`) used in SC-2/SC-3 tests for
  `app.get()`/`app.use()` Effect returns — types don't include `EffectLike` yet
  (Phase 7 concern). Runtime dispatch via `isEffectLike()` in `runMiddlewares()`
  works correctly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated define.ts from setEffectResolver to
setEffectRunner**

- **Found during:** Task 1 (Update effectPlugin() to use setEffectRunner)
- **Issue:** `packages/plugin-effect/src/define.ts` imported `setEffectResolver`
  from `@fresh/core/internal` — that export no longer exists after 06-01.
  `deno check` failed on `mod.ts` because it imports `define.ts`.
- **Fix:** Updated `define.ts` to import and use `setEffectRunner`. Changed
  standalone path signature from `createEffectDefine(opts?)` to
  `createEffectDefine(app?, opts?)`. Throws descriptive error if `layer`
  provided without `app`.
- **Files modified:** `packages/plugin-effect/src/define.ts`,
  `packages/plugin-effect/tests/define_test.ts`
- **Verification:** `deno check packages/plugin-effect/src/` passes; all 5
  define_test.ts tests pass
- **Committed in:** `32f5645f` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking) **Impact on plan:** Auto-fix
necessary — define.ts was broken without it. define_test.ts updated in same
commit. No scope creep.

## Issues Encountered

- `deno test` without `--allow-env` fails with `NotCapable` error for
  `DENO_DEPLOYMENT_ID` — pre-existing issue noted in STATE.md. Tests run
  correctly with `--allow-env` flag.

## Next Phase Readiness

- Phase 6 complete: per-app `#effectRunner` field added (06-01), `plugin-effect`
  updated to use new API (06-02)
- Phase 7 (`07-effect-package`) can build `@fresh/effect` package using
  `setEffectRunner` API; `plugin-effect` becomes compat shim
- Type gap for `app.get()`/`app.use()` Effect returns documented — Phase 7 can
  add `EffectLike` to `Middleware` type if desired

---

_Phase: 06-fresh-core-plumbing_ _Completed: 2026-02-25_
