---
phase: 08-httpapi-integration
plan: 01
subsystem: api
tags: [
  effect,
  httpapi,
  fresh,
  middleware,
  layer,
  managed-runtime,
  signal-disposal,
]

# Dependency graph
requires:
  - phase: 07-fresh-effect-package
    provides: EffectApp class, createEffectApp(), ManagedRuntime lifecycle, registerSignalDisposal
provides:
  - EffectApp.httpApi(prefix, api, ...groupLayers) method with HttpRouter.toWebHandler integration
  - #httpApiDisposers array for tracking Effect HTTP sub-handler runtimes
  - Updated dispose() that tears down all httpApi sub-handlers before main runtime
  - registerSignalDisposal accepting generic () => Promise<void> instead of ManagedRuntime
  - SIGINT/SIGTERM now routes through effectApp.dispose() ensuring all resources cleaned up
  - Import map entries for effect/unstable/http, effect/unstable/httpapi, effect/Schema
affects: [08-02, 09-rpc-integration, 10-migration-example]

# Tech tracking
tech-stack:
  added: [
    effect/unstable/http (HttpRouter,
    HttpServer),
    effect/unstable/httpapi (HttpApiBuilder),
  ]
  patterns:
    - HttpRouter.toWebHandler converts Layer to web handler with shared memoMap
    - Fresh middleware at prefix delegates to Effect HTTP handler for HttpApi requests
    - #httpApiDisposers accumulate disposers; iterated in dispose() before main runtime
    - Signal disposal wraps effectApp.dispose() not runtime.dispose() to reach all resources

key-files:
  created: []
  modified:
    - packages/effect/src/app.ts
    - packages/effect/src/runtime.ts
    - packages/effect/deno.json

key-decisions:
  - "registerSignalDisposal accepts generic disposeFn not ManagedRuntime — enables calling EffectApp.dispose() on signal"
  - "createEffectApp creates EffectApp first then registers signal disposal through effectApp.dispose() to include httpApi sub-handlers"
  - "_setCleanupSignals internal setter used because signal registration must happen after EffectApp construction"
  - "Layer.mergeAll spread cast to [any, ...any[]] and apiLayer cast to any for toWebHandler — all args are any so safe"
  - "handler cast to any for call — toWebHandler returns conditional type that requires context arg when HR is not never"
  - "deno-lint-ignore no-explicit-any used conservatively — httpApi method already typed with any for runtime flexibility"

patterns-established:
  - "httpApi pattern: HttpApiBuilder.layer(api) | Layer.provide(groupLayer) | Layer.provide(HttpServer.layerServices) | HttpRouter.toWebHandler"
  - "memoMap sharing: toWebHandler receives this.#runtime.memoMap so group implementations can reuse app services"
  - "Dispose ordering: cleanupSignals() → httpApiDisposers (ordered) → main runtime"

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 8 Plan 1: HttpApi Integration — EffectApp.httpApi() Summary

**EffectApp.httpApi() mounts Effect HttpApi definitions in Fresh via
HttpRouter.toWebHandler with shared memoMap and full dispose integration through
SIGINT/SIGTERM**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-26T13:45:55Z
- **Completed:** 2026-02-26T13:48:22Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `EffectApp.httpApi(prefix, api, ...groupLayers)` that builds the HttpApi
  Layer, converts to a web handler via `HttpRouter.toWebHandler()`, and
  registers a Fresh middleware at the prefix
- Fixed signal disposal so SIGINT/SIGTERM calls `effectApp.dispose()` — which
  disposes httpApi sub-handler runtimes before the main ManagedRuntime — instead
  of calling `runtime.dispose()` directly
- Added deno.json import map entries enabling
  `import { HttpRouter } from "effect/unstable/http"` and
  `import { HttpApiBuilder } from "effect/unstable/httpapi"` in @fresh/effect
  source

## Task Commits

Each task was committed atomically:

1. **Task 1: Add deno.json import map entries for HttpApi modules** - `7b07301a`
   (chore)
2. **Task 2: Implement EffectApp.httpApi() with dispose integration and signal
   handler fix** - `e3fdc943` (feat)

**Plan metadata:** (docs: complete plan — see below)

## Files Created/Modified

- `packages/effect/src/app.ts` - Added httpApi() method, #httpApiDisposers
  field, updated dispose(), updated EffectApp constructor and createEffectApp()
  signal registration
- `packages/effect/src/runtime.ts` - Changed registerSignalDisposal to accept
  generic `() => Promise<void>` instead of ManagedRuntime
- `packages/effect/deno.json` - Added effect/unstable/http,
  effect/unstable/httpapi, effect/Schema import map entries

## Decisions Made

- **registerSignalDisposal accepts generic disposeFn:** Changed from
  `ManagedRuntime` to `() => Promise<void>` so the signal handler can call
  `effectApp.dispose()` which chains through all httpApi sub-handlers before the
  main runtime. Backward-compatible (existing tests pass).

- **_setCleanupSignals internal setter:** Since signal registration must happen
  after EffectApp construction (to capture `effectApp` in the closure), a
  two-phase pattern is used: construct EffectApp with no-op cleanup, register
  signal disposal through effectApp.dispose(), then call `_setCleanupSignals()`
  to store the resulting unsubscribe function.

- **Layer/handler casts to `any`:** `httpApi()` uses `any` throughout since
  HttpApi types are complex generics. The casts are safe:
  `Layer.mergeAll(...groupLayers as [any, ...any[]])` for the spread type issue;
  `apiLayer as any` for toWebHandler's constrained R parameter; `handler as any`
  for the conditional handler type requiring a context argument when HR is not
  never.

- **No mod.ts re-exports for HttpApi types:** Users import from
  `effect/unstable/httpapi` directly (idiomatic Effect). The deno.json import
  map entries make this work without the package needing to re-export.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type errors in httpApi() method required strategic `any`
casts**

- **Found during:** Task 2 (deno check verification)
- **Issue:** Three type errors: (a) TS2556 — spread of `any[]` to
  `Layer.mergeAll` not a valid rest; (b) TS2345 —
  `Layer<never, unknown, unknown>` not assignable to `toWebHandler`'s
  constrained R; (c) TS2554 — conditional handler type requires context arg when
  HR is not never
- **Fix:** Cast `groupLayers` to `[any, ...any[]]` for mergeAll spread; cast
  `apiLayer` to `any` for toWebHandler; cast `handler` to `any` for the call.
  Added `// deno-lint-ignore no-explicit-any` where needed.
- **Files modified:** `packages/effect/src/app.ts`
- **Verification:** `deno check packages/effect/src/mod.ts` passes cleanly
- **Committed in:** e3fdc943 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — type cast required for any-typed
method) **Impact on plan:** Minor — the plan already specified
`// deno-lint-ignore no-explicit-any` for the method signature. The additional
casts in the implementation body are consistent with that intent. No scope
change.

## Issues Encountered

None — all type errors resolved via targeted `any` casts consistent with the
plan's `no-explicit-any` allowances.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `EffectApp.httpApi()` is fully implemented and `deno check` passes
- All 6 existing tests pass (5 app_test + 1 signal_test)
- Phase 8 Plan 2 can proceed: writing integration tests for httpApi() to verify
  end-to-end request routing, dispose behavior, and memoMap sharing
- No blockers

---

_Phase: 08-httpapi-integration_ _Completed: 2026-02-26_
