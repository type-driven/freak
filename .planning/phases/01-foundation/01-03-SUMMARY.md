---
phase: 01-foundation
plan: 03
subsystem: api
tags: [effect, fresh, deno, typescript, testing, integration-tests, resolver, error-handling]

# Dependency graph
requires:
  - phase: 01-01
    provides: "setEffectResolver() hook and EffectLike duck-type in @fresh/core"
  - phase: 01-02
    provides: "effectPlugin() middleware, createResolver(), isEffect() — the dispatch pipeline to test"
provides:
  - resolver_test.ts: 14 unit tests for isEffect detection, success path, failure path, mapError, Cause<E>
  - plugin_test.ts: 6 unit tests for effectPlugin() zero-config and custom Layer wiring
  - integration_test.ts: 7 integration tests through Fresh's full request path via App.route() + FakeServer
  - Refined resolver.ts: descriptive Error wrapping with Cause<E> preserved in error.cause
  - Documented discovery: Effect resolver runs via app.route() (renderRoute path), not app.get() (Handler path)
affects:
  - Future phases (proof that Effect dispatch pipeline is correct end-to-end)
  - Phase 2+ (integation test pattern established for Effect handlers)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Integration tests via App.route() + FakeServer (not app.get() — Handler commands bypass renderRoute)
    - Per-test ManagedRuntime creation/disposal (via makeTestRuntime() helper with double-cast)
    - Effect v4 service definition uses ServiceMap.Service (not Context.Tag from v3)
    - asMiddleware() cast helper not needed when using app.route() — EffectLike is in HandlerFn return type

key-files:
  created:
    - packages/plugin-effect/tests/resolver_test.ts
    - packages/plugin-effect/tests/plugin_test.ts
    - packages/plugin-effect/tests/integration_test.ts
  modified:
    - packages/plugin-effect/src/resolver.ts

key-decisions:
  - "Use app.route() for Effect handler integration tests — renderRoute() calls _effectResolver; app.get() Handler commands bypass it entirely"
  - "makeTestRuntime() helper with unknown double-cast for ManagedRuntime<never,never> -> ManagedRuntime<any,any> — TypeScript strict variance requires double-cast through unknown"
  - "ServiceMap.Service replaces Context.Tag for Effect v4 service definitions — Context is not exported from effect@4.0.0-beta.0"
  - "Resolver wraps failure in standard Error with Cause preserved in error.cause — Fresh error handling requires Error instances, not raw Effect Cause values"

patterns-established:
  - "Integration test pattern: App.route() + FakeServer for full Fresh request path testing with Effect handlers"
  - "Effect handler test isolation: per-test runtime creation + disposal in finally block"

# Metrics
duration: 8min
completed: 2026-02-18
---

# Phase 1 Plan 3: Tests and Resolver Refinement Summary

**27 tests across 3 files validate the full Effect dispatch pipeline end-to-end — resolver unit tests, plugin wiring tests, and App+FakeServer integration tests through Fresh's renderRoute path**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-18T22:42:48Z
- **Completed:** 2026-02-18T22:50:48Z
- **Tasks:** 2
- **Files modified:** 1 modified, 3 created

## Accomplishments

- `resolver.ts` failure path upgraded: now wraps raw Effect `Cause<E>` in a descriptive `Error` with `error.cause = cause` for Fresh compatibility
- `ResolverOptions.mapError` JSDoc updated to document that the callback receives a `Cause<E>` (structured Effect wrapper), not a plain `Error`
- `resolver_test.ts`: 14 tests covering `isEffect()` detection (7 cases), success path (4), failure path (1), and `mapError` with `Cause<E>` verification (2)
- `plugin_test.ts`: 6 tests verifying `effectPlugin()` zero-config and `{ layer }` paths, middleware attachment, and runtime Effect dispatch
- `integration_test.ts`: 7 tests through Fresh's full request pipeline using `App.route()` + `FakeServer` — SC-1 and SC-3 success criteria verified
- All 27 tests pass; `deno check` clean on both `@fresh/core` and `plugin-effect`; no `npm:effect` import in `packages/fresh/src/`

## Task Commits

Each task was committed atomically:

1. **Task 1: Refine resolver error dispatch and write resolver unit tests** - `0c0754da` (feat)
2. **Task 2: Write plugin unit tests and full integration tests** - `b0da6bc1` (test)

## Files Created/Modified

- `packages/plugin-effect/src/resolver.ts` - Refined: descriptive Error wrapping with Cause<E> in error.cause; JSDoc updated for mapError Cause semantics
- `packages/plugin-effect/tests/resolver_test.ts` - 14 unit tests for isEffect detection, success, failure, and mapError paths
- `packages/plugin-effect/tests/plugin_test.ts` - 6 unit tests for effectPlugin() wiring and runtime dispatch
- `packages/plugin-effect/tests/integration_test.ts` - 7 integration tests through Fresh's full request path

## Decisions Made

- **app.route() not app.get() for Effect integration tests**: The Effect resolver (`_effectResolver`) is called inside `renderRoute()` in `segments.ts`. `app.get()` creates `HandlerCommand` entries that bypass `renderRoute` entirely — the middleware return value goes straight to the app handler check at `app.ts:447`. `app.route()` creates `RouteCommand` entries that call `renderRoute` as their final middleware, which is where the resolver is invoked. This is the correct integration path.

- **makeTestRuntime() with double-cast**: `ManagedRuntime.make(Layer.empty)` returns `ManagedRuntime<never, never>` but `createResolver()` expects `ManagedRuntime<any, any>`. TypeScript's strict variance rejects direct cast (`as ManagedRuntime<any, any>`) because `any` is not comparable to `never`. The solution is a double-cast through `unknown`: `as unknown as ManagedRuntime<any, any>`.

- **ServiceMap.Service replaces Context.Tag**: Effect v4.0.0-beta.0 does not export `Context` from the main `effect` module. The v4 API for defining services uses `ServiceMap.Service<Interface>(key)` instead of `class Svc extends Context.Tag('key')<Svc, Interface>() {}`. Updated plugin_test.ts accordingly.

- **Standard Error wrapping**: The original resolver threw `exit.cause` directly (a raw `Cause<E>` object). Fresh's `DEFAULT_ERROR_HANDLER` checks `err instanceof HttpError`; non-HttpError values trigger `console.error(error)` and return 500. Throwing a raw object works at runtime but produces poor stack traces. The updated resolver wraps `exit.cause` in a standard `Error` with the original Cause preserved in `error.cause` — better debugging and explicit semantics.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ManagedRuntime type variance requires double-cast in test helper**

- **Found during:** Task 1 (first test run)
- **Issue:** `ManagedRuntime<never, never>` is not directly castable to `ManagedRuntime<any, any>` due to TypeScript strict variance. Single `as` cast rejected with TS2352.
- **Fix:** Added `makeTestRuntime()` helper that double-casts through `unknown`: `ManagedRuntime.make(Layer.empty) as unknown as ManagedRuntime<any, any>`
- **Files modified:** `packages/plugin-effect/tests/resolver_test.ts`
- **Committed in:** `0c0754da` (Task 1 commit)

**2. [Rule 1 - Bug] Effect v4 does not export Context (was Context.Tag in v3)**

- **Found during:** Task 2 (plugin_test.ts type check)
- **Issue:** Plan template used `import { Context as EffectContext } from "effect"` and `class Svc extends EffectContext.Tag(...)`. Effect v4.0.0-beta.0 does not export `Context` — service definition uses `ServiceMap.Service<Interface>(key)` instead.
- **Fix:** Replaced `Context.Tag` pattern with `ServiceMap.Service<{ readonly greet: (name: string) => string }>('GreetingService')` and `Layer.succeed(GreetingService, { ... })`
- **Files modified:** `packages/plugin-effect/tests/plugin_test.ts`
- **Committed in:** `b0da6bc1` (Task 2 commit)

**3. [Rule 1 - Bug] Effect resolver only fires via app.route(), not app.get()**

- **Found during:** Task 2 (first integration test run — all 4 Effect-dependent tests returned 500 for success cases)
- **Issue:** Plan specified integration tests using `app.get(() => Effect.succeed(...))`. The Effect resolver (`_effectResolver`) is called inside `renderRoute()` in `segments.ts`. `app.get()` creates `HandlerCommand` entries that bypass `renderRoute` — the middleware's return value (an Effect object) goes directly to the app handler which rejects non-Response values with 500.
- **Fix:** Changed all integration test routes to use `app.route("/path", { handler: () => Effect.succeed(...) })`. `RouteCommand` entries call `renderRoute` which invokes `_effectResolver`. Also removed the `asMiddleware()` cast helper (not needed with `app.route()`).
- **Files modified:** `packages/plugin-effect/tests/integration_test.ts`
- **Committed in:** `b0da6bc1` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 type/API bugs from plan assumptions, 1 architectural discovery about renderRoute dispatch path)
**Impact on plan:** All deviations were auto-fixed within the task. The architecture discovery (app.route() vs app.get()) is documented and clarifies the integration test pattern for future phases.

## Issues Encountered

Deno test permissions: `packages/build-id` reads `DENO_DEPLOYMENT_ID` from environment at module load time. Plugin-effect tests require `-A` (all permissions) or at minimum `--allow-env` when importing from `@fresh/core` transitively. The workspace `deno task test` already passes `-A` so this is not a production concern.

## User Setup Required

None.

## Next Phase Readiness

- Phase 1 success criteria are fully validated:
  - SC-1: `Effect.succeed(Response)` through full Fresh path produces correct HTTP response (integration_test.ts)
  - SC-3: `Effect.fail` and `Effect.die` produce 500 responses (not crashes) (integration_test.ts)
  - No `npm:effect` in `packages/fresh/src/` (verified by grep)
  - `effectPlugin()` zero-config and `{ layer }` paths work (plugin_test.ts)
- Phase 2 can build on the established test pattern: use `app.route()` for Effect handler integration tests
- The resolver error wrapping decision (standard Error + error.cause) is the pattern for Phase 2 error taxonomy work

---
*Phase: 01-foundation*
*Completed: 2026-02-18*
