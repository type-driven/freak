---
phase: 02-type-safe-api
plan: 01
subsystem: api
tags: [effect, fresh, typescript, type-safety, createEffectDefine, ServiceMap]

# Dependency graph
requires:
  - phase: 01-01
    provides: "setEffectResolver() hook and EffectLike duck-type in @fresh/core"
  - phase: 01-02
    provides: "effectPlugin() middleware, createResolver(), makeRuntime()"
provides:
  - createEffectDefine<State, R>() factory in packages/plugin-effect/src/define.ts
  - EffectHandlerFn, EffectHandlerByMethod, EffectRouteHandler, EffectDefine, CreateEffectDefineOptions types
  - Type-safe R constraint enforcement for Effect route handlers
  - Standalone Layer path (no effectPlugin required)
affects:
  - Future phases (typed define wrapper available for all Effect handlers)
  - Phase 5 (example will use createEffectDefine)

# Tech tracking
tech-stack:
  added:
    - "npm:expect-type@^1.1.0 (test dependency, added to plugin-effect deno.json)"
  patterns:
    - "Identity function as compile-time constraint: handlers() is no-op at runtime, types enforced by TypeScript"
    - "ServiceMap.Service.Identifier<typeof Service> for correct R type extraction in Effect v4"
    - "Standalone Layer path: createEffectDefine({ layer }) registers its own ManagedRuntime"
    - "@ts-expect-error placed directly above method property (not call site) for negative type tests"

key-files:
  created:
    - packages/plugin-effect/src/define.ts
    - packages/plugin-effect/tests/define_types_test.ts
    - packages/plugin-effect/tests/define_test.ts
  modified:
    - packages/plugin-effect/src/mod.ts
    - packages/plugin-effect/deno.json

key-decisions:
  - "Use ServiceMap.Service.Identifier<typeof Service> as R type parameter — typeof Service gives full Service<I,S> object type, not the Identifier (which is what Effect.gen yields as R)"
  - "@ts-expect-error must be placed directly above the method property in the handler object, not above the handlers() call site — TypeScript reports errors at the property level"
  - "Add expect-type to deno.json imports (not inline npm: specifier) for cleaner import paths in tests"
  - "Use FakeServer.post() for POST tests, not server.fetch() — FakeServer does not expose raw fetch()"

patterns-established:
  - "createEffectDefine<State, R>() mirrors createDefine<State>() from @fresh/core but adds R constraint"
  - "Standalone path (with layer) creates its own ManagedRuntime and registers resolver via setEffectResolver()"
  - "Type-parameter-only path (no layer) skips runtime setup, relies on effectPlugin()"
  - "handlers() is always an identity function — zero runtime overhead"

# Metrics
duration: 6min
completed: 2026-02-21
---

# Phase 2 Plan 1: createEffectDefine Factory Summary

**Type-safe Effect route handler factory with compile-time R constraint
enforcement via identity-function-at-runtime pattern, standalone Layer path
using ManagedRuntime.**

## Performance

- **Duration:** ~6 minutes
- **Started:** 2026-02-21T00:48:05Z
- **Completed:** 2026-02-21T00:54:05Z
- **Tasks:** 2
- **Files modified:** 5 (2 created source, 3 created test, 2 modified)

## Accomplishments

- Implemented `createEffectDefine<State, R>()` factory with full type parameter
  threading
- SC-1 verified: R type parameter threads through handler return types —
  positive type tests pass
- SC-2 verified: Undeclared service causes compile error — @ts-expect-error
  negative tests confirmed
- Standalone path creates ManagedRuntime from Layer, registers Effect resolver,
  registers disposal
- Type-parameter-only path (no Layer) compiles cleanly and skips runtime setup
- handlers() is identity function — returns input unchanged with zero runtime
  overhead
- E type fixed to `unknown` in EffectHandlerFn — not a generic parameter
- Method map uses `Method` type from `@fresh/core` for HTTP method key
  constraint
- 13 new tests (8 type-level, 5 runtime) + 27 existing tests all passing (40
  total)

## Task Commits

1. **Task 1: Create define.ts and export from mod.ts** - `bfe47830` (feat)
2. **Task 2: Write type-level and runtime tests** - `d560c341` (test)

## Files Created/Modified

- `packages/plugin-effect/src/define.ts` - createEffectDefine factory, all
  EffectHandler* types
- `packages/plugin-effect/src/mod.ts` - added createEffectDefine and type
  re-exports
- `packages/plugin-effect/tests/define_types_test.ts` - 8 type-level tests (SC-1
  positive, SC-2 negative)
- `packages/plugin-effect/tests/define_test.ts` - 5 runtime tests (standalone
  path, POST, identity)
- `packages/plugin-effect/deno.json` - added expect-type dependency

## Decisions Made

1. **ServiceMap.Service.Identifier<T> for R type parameter**: When
   `ServiceMap.Service<Shape>(key)` is used with one type parameter, the
   Identifier type = Shape. Effect.gen's R captures the Identifier. Using
   `typeof DbService` as R gives the full Service<I,S> object type which doesn't
   match. Must use `ServiceMap.Service.Identifier<typeof DbService>` to get the
   correct R.

2. **@ts-expect-error placement**: Must be placed directly above the method
   property (`POST:`) inside the handler object, not above the
   `define.handlers({` call. TypeScript reports errors at the property
   assignment level, not the outer call site.

3. **expect-type in deno.json imports**: Added as
   `"expect-type": "npm:expect-type@^1.1.0"` to deno.json rather than using
   inline `npm:` specifiers in test files — cleaner and consistent with project
   conventions.

4. **FakeServer.post() not server.fetch()**: FakeServer API has `.get()`,
   `.post()`, `.patch()`, `.put()`, `.delete()`, `.head()`, `.options()`
   convenience methods but not a raw `.fetch()` method.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected R type parameter for ServiceMap.Service**

- **Found during:** Task 2 (type-level tests authoring)
- **Issue:** Plan specified `typeof DbService` as the R type parameter for
  `createEffectDefine<unknown, typeof DbService>`. However,
  `ServiceMap.Service<Shape>(key)` returns `Service<Identifier, Shape>` where
  Identifier=Shape (with one type param). `typeof DbService` is
  `Service<{query:...}, {query:...}>` — the full Service object type. But
  Effect.gen's R is the Identifier type `{query:...}`, not `Service<...>`. Using
  `typeof DbService` as R caused a Layer assignability error because
  `Layer.succeed(DbService, ...)` produces `Layer<{query:...}, never, never>`
  which doesn't match `Layer<Service<{query:...},{query:...}>, unknown, never>`.
- **Fix:** Used `ServiceMap.Service.Identifier<typeof DbService>` to extract the
  correct Identifier type, which IS what Effect.gen uses as R. This makes types
  consistent throughout.
- **Files modified:** `packages/plugin-effect/tests/define_types_test.ts`,
  `packages/plugin-effect/tests/define_test.ts`
- **Commits:** Part of `d560c341`

**2. [Rule 1 - Bug] Corrected @ts-expect-error placement**

- **Found during:** Task 2 (type-level tests verification)
- **Issue:** Plan's test code placed `@ts-expect-error` above the
  `define.handlers({` call, but TypeScript reports the error on the method
  property line (`POST: () => ...`). @ts-expect-error suppresses the error on
  the NEXT line only, so wrong placement causes "Unused @ts-expect-error
  directive" failure.
- **Fix:** Moved `@ts-expect-error` to be directly above `POST:` inside the
  handlers object (placed as a comment on the method property line itself).
- **Files modified:** `packages/plugin-effect/tests/define_types_test.ts`
- **Commits:** Part of `d560c341`

**3. [Rule 3 - Blocking] Added expect-type to deno.json imports**

- **Found during:** Task 2 (initial deno check after creating
  define_types_test.ts)
- **Issue:** `npm:expect-type@^1.1.0` import caused "Could not find matching
  package" error — deno.json had no expect-type entry and `deno install` hadn't
  resolved it.
- **Fix:** Added `"expect-type": "npm:expect-type@^1.1.0"` to
  `packages/plugin-effect/deno.json` imports and ran `deno install`.
- **Files modified:** `packages/plugin-effect/deno.json`
- **Commits:** Part of `d560c341`

**4. [Rule 3 - Blocking] Replaced FakeServer.fetch() with FakeServer.post()**

- **Found during:** Task 2 (deno check on define_test.ts)
- **Issue:** Plan specified `server.fetch(new Request(..., { method: "POST" }))`
  but FakeServer doesn't expose a raw `.fetch()` method.
- **Fix:** Used `server.post("/submit")` — FakeServer's built-in POST
  convenience method.
- **Files modified:** `packages/plugin-effect/tests/define_test.ts`
- **Commits:** Part of `d560c341`

## Issues Encountered

- Effect v4 ServiceMap.Service type system is nuanced: `typeof Service` vs
  `Service.Identifier<typeof Service>` distinction is not documented prominently
  but is critical for correct R type parameter threading. This affects how users
  write `createEffectDefine<State, R>()` calls.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 2 Plan 2 is ready to execute. `createEffectDefine` is fully implemented
and tested. The R type constraint mechanism is working. Next plans in Phase 2
can build on this foundation. Note the ServiceMap.Service.Identifier pattern for
future test authoring involving Effect services.

---

_Phase: 02-type-safe-api_ _Completed: 2026-02-21_
