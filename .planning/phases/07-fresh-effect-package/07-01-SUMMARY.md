---
phase: 07-fresh-effect-package
plan: 01
subsystem: api
tags: [effect, fresh, effect-ts, managed-runtime, signal-handlers, typescript]

# Dependency graph
requires:
  - phase: 06-fresh-core-plumbing
    provides: "setEffectRunner(app, fn) per-app API and EffectRunner type in @fresh/core/internal"
provides:
  - "@fresh/effect package with deno.json manifest"
  - "EffectApp<State, AppR> class proxying all App builder methods with Effect-typed handlers"
  - "createEffectApp({ layer }) factory wiring ManagedRuntime + EffectRunner + signal handlers"
  - "createEffectDefine() type-only wrapper (no app/layer args)"
  - "createResolver() + isEffect() from resolver.ts"
  - "makeRuntime() + registerSignalDisposal() using Deno signal listeners"
  - "mod.ts public API barrel"
affects:
  - 07-fresh-effect-package plan 02 (tests for createEffectApp)
  - 08-httpapi-integration
  - 09-rpc-integration

# Tech tracking
tech-stack:
  added:
    - "@fresh/effect (new package)"
  patterns:
    - "EffectApp wraps App<State> — Fresh routing untouched, Effect owns lifecycle"
    - "Signal-based ManagedRuntime disposal (SIGINT/SIGTERM) instead of unload event"
    - "createEffectDefine() is type-only — no runtime setup, no app argument"
    - "setEffectRunner called at createEffectApp() time (factory), not at .handler() time"

key-files:
  created:
    - packages/effect/deno.json
    - packages/effect/src/app.ts
    - packages/effect/src/define.ts
    - packages/effect/src/resolver.ts
    - packages/effect/src/runtime.ts
    - packages/effect/src/types.ts
    - packages/effect/src/mod.ts
  modified: []

key-decisions:
  - "createEffectDefine in @fresh/effect is type-only (no app/layer args) — runtime is EffectApp's job"
  - "registerSignalDisposal uses Deno.addSignalListener (SIGINT/SIGTERM) not globalThis.addEventListener('unload')"
  - "setEffectRunner cast to App<any> needed due to State type variance in BuildCache — safe at runtime"
  - "EffectApp.mountApp accepts App<State> not EffectApp — plain App for micro-app composition"

patterns-established:
  - "EffectApp proxies all App methods and returns `this` for chaining"
  - "Factory pattern: createEffectApp creates App + ManagedRuntime + resolver + runner atomically"
  - "dispose() method for programmatic teardown (removes signal listeners, disposes runtime)"

# Metrics
duration: 3min
completed: 2026-02-25
---

# Phase 7 Plan 01: @fresh/effect Package — Core API Summary

**`@fresh/effect` package with EffectApp<State, AppR> wrapping App<State>,
createEffectApp factory wiring ManagedRuntime via setEffectRunner, and
SIGINT/SIGTERM signal-based disposal**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-25T21:47:52Z
- **Completed:** 2026-02-25T21:51:03Z
- **Tasks:** 2
- **Files modified:** 7 created

## Accomplishments

- Created `packages/effect/` package with `deno.json` manifest (`@fresh/effect`
  name, exports `.`)
- `EffectApp<State, AppR>` class proxying all 13 App builder methods with
  Effect-compatible handler types
- `createEffectApp({ layer })` factory: creates App, ManagedRuntime, resolver,
  calls `setEffectRunner()` before returning
- `registerSignalDisposal()` uses `Deno.addSignalListener(SIGINT/SIGTERM)` —
  replaces old `unload` event approach
- `createEffectDefine()` is type-only — no `app` or `layer` args, no runtime
  setup

## Task Commits

Each task was committed atomically:

1. **Task 1: Package scaffold + resolver/runtime/types/define modules** -
   `a9e507a7` (feat)
2. **Task 2: EffectApp class, createEffectApp factory, mod.ts barrel** -
   `f9f60c7d` (feat)

**Plan metadata:** (see docs commit below)

## Files Created/Modified

- `packages/effect/deno.json` - Package manifest: `@fresh/effect`, exports
  `./src/mod.ts`
- `packages/effect/src/types.ts` - Re-exports `Layer` and `ManagedRuntime` types
  from effect
- `packages/effect/src/resolver.ts` - `createResolver()`, `isEffect()`,
  `ResolverOptions` (from plugin-effect)
- `packages/effect/src/runtime.ts` - `makeRuntime()` +
  `registerSignalDisposal()` with Deno signal listeners
- `packages/effect/src/define.ts` - `createEffectDefine()` type-only wrapper,
  `EffectDefine` interface
- `packages/effect/src/app.ts` - `EffectApp<State, AppR>` class +
  `createEffectApp` factory
- `packages/effect/src/mod.ts` - Public API barrel export

## Decisions Made

- **createEffectDefine is type-only:** In `@fresh/effect`,
  `createEffectDefine()` takes no `app` or `layer` arguments. The v2 design
  delegates all runtime management to `EffectApp`. This simplifies the API — you
  just call `createEffectDefine<State, R>()` after creating the app with
  `createEffectApp({ layer })`.

- **Signal disposal over `unload`:** `registerSignalDisposal` uses
  `Deno.addSignalListener("SIGINT")` and `Deno.addSignalListener("SIGTERM")`
  (guarded by `Deno.build.os !== "windows"`). This fires reliably on server
  shutdown, unlike `unload` which is unreliable with `Deno.serve`.

- **App<any> cast in setEffectRunner:**
  `setEffectRunner(app as App<any>, runner)` required because `App<State>` is
  not assignable to `App<unknown>` due to contravariant use of `State` in
  component prop types. Safe at runtime since the runner only cares about the
  EffectRunner slot.

- **EffectApp.mountApp accepts App<State>:** For micro-app composition,
  `mountApp` takes a plain `App<State>` (not `EffectApp`). This maintains
  compatibility with apps that don't use Effect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `App<any>` cast for `setEffectRunner` call**

- **Found during:** Task 2 (createEffectApp factory implementation)
- **Issue:** TypeScript rejected `setEffectRunner(app, runner)` — `App<State>`
  is not assignable to `App<unknown>` due to `State` variance in
  `BuildCache<State>` generic chain
- **Fix:** Added `// deno-lint-ignore no-explicit-any` and cast
  `app as App<any>` at the call site
- **Files modified:** `packages/effect/src/app.ts`
- **Verification:** `deno check packages/effect/src/mod.ts` passes cleanly
- **Committed in:** `f9f60c7d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type variance bug) **Impact on
plan:** Fix was necessary and safe — the cast is equivalent to the `App<any>`
type used in `setEffectRunner`'s signature in `app.ts`. No scope creep.

## Issues Encountered

None — type variance issue was caught immediately by `deno check` and fixed
in-line.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `@fresh/effect` package is ready for Plan 02 (integration tests)
- `createEffectApp`, `EffectApp`, `createEffectDefine`, `isEffect` all exported
  from `mod.ts`
- `deno check packages/effect/src/mod.ts` passes cleanly
- Signal disposal tested structurally (returns cleanup fn); runtime tests in
  Plan 02

---

_Phase: 07-fresh-effect-package_ _Completed: 2026-02-25_
