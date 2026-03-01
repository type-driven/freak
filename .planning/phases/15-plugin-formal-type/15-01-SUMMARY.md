---
phase: 15-plugin-formal-type
plan: 01
subsystem: api
tags: [typescript, plugin, fresh, effect, deno, type-safety, phantom-types]

# Dependency graph
requires:
  - phase: 14-typed-app-composition
    provides: createCounterPlugin<S>, mountApp, runEffect, setAtom, generic EffectApp/App composition
provides:
  - Plugin<Config, S, R> interface in @fresh/core with phantom R type parameter
  - createPlugin(config, factory) factory function with explicit JSR-compliant return type
  - App.mountApp overload accepting Plugin<Config, State, R> for type-safe plugin mounting
  - EffectApp.mountApp overload accepting Plugin<Config, State, PluginR>
  - createCounterPlugin migrated from returning App<S> to returning Plugin<Record<string,never>, S, CounterServiceIdentifier>
  - PLUG-03 type-level tests: mounting incompatible Plugin state shapes is a TypeScript compile error
  - 16 new passing tests (6 plugin_test.ts unit tests + 2 PLUG-03 integration tests + 8 existing preserved)
affects:
  - 16-plugin-islands
  - 17-ctx-state-namespacing

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plugin<Config, S, R> phantom type: R documents Effect service requirements at type level without importing Effect into @fresh/core"
    - "instanceof App discriminator: use !(appOrPlugin instanceof App) not 'handler' in obj to distinguish Plugin from App at runtime"
    - "Overloaded mountApp: named overloads for Plugin and App allow TypeScript to enforce S compatibility without union confusion"
    - "createPlugin explicit return type: required for JSR slow-types compliance"

key-files:
  created:
    - packages/fresh/src/plugin.ts
    - packages/fresh/tests/plugin_test.ts
  modified:
    - packages/fresh/src/mod.ts
    - packages/fresh/src/app.ts
    - packages/effect/src/app.ts
    - packages/examples/typed-composition/counter_plugin.tsx
    - packages/examples/typed-composition/integration_test.ts

key-decisions:
  - "Plugin<Config,S,R>: R is phantom (readonly _phantom?: R) — @fresh/core never imports Effect, R only documents requirements"
  - "instanceof App discriminator: 'handler' in appInstance is always true (prototype chain), instanceof App is the correct runtime test"
  - "createPlugin explicit return type required: JSR slow-types compliance"
  - "CounterServiceIdentifier = typeof CounterService: type-level alias exports the service tag type as the R parameter"

patterns-established:
  - "Plugin type: Plugin<Config, S, R> for typed Fresh plugins — Config=options shape, S=host state requirement, R=Effect services"
  - "Plugin overload: mountApp(path, plugin: Plugin<Config, State, R>): this — TypeScript errors on state shape mismatch"
  - "PLUG-03 pattern: @ts-expect-error on mountApp with incompatible Plugin state verified non-redundant via deno check"

# Metrics
duration: 4min
completed: 2026-03-01
---

# Phase 15 Plan 01: Plugin Formal Type Summary

**Plugin<Config,S,R> phantom-typed interface with createPlugin() factory; App and EffectApp mountApp overloads enforce host state compatibility at compile time**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T20:56:54Z
- **Completed:** 2026-03-01T21:01:01Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- `Plugin<Config, S, R>` interface added to `@fresh/core` with phantom R for Effect service documentation
- `createPlugin(config, factory)` factory with explicit return type (JSR slow-types compliant)
- `App.mountApp` and `EffectApp.mountApp` overloaded to accept `Plugin<Config, State, R>` — TypeScript errors on incompatible state shapes
- `createCounterPlugin` migrated to return `Plugin<>` directly (previously returned `App<S>`)
- 6 unit tests in `plugin_test.ts` + 2 PLUG-03 tests in `integration_test.ts`; all 16 new tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Plugin<Config,S,R> interface, createPlugin() factory, App.mountApp overload** - `1cf9e68e` (feat)
2. **Task 2: EffectApp.mountApp overload, createCounterPlugin->createPlugin migration, PLUG-03 tests** - `533436f4` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `packages/fresh/src/plugin.ts` - Plugin<Config,S,R> interface and createPlugin() factory
- `packages/fresh/src/mod.ts` - Re-exports Plugin type and createPlugin function
- `packages/fresh/src/app.ts` - Imports Plugin type; mountApp overloaded for Plugin and App<State>
- `packages/effect/src/app.ts` - Imports Plugin from @fresh/core; EffectApp.mountApp overloaded
- `packages/examples/typed-composition/counter_plugin.tsx` - createCounterPlugin returns Plugin<>; CounterServiceIdentifier type alias
- `packages/examples/typed-composition/integration_test.ts` - createPlugin import; PLUG-03 type error tests
- `packages/fresh/tests/plugin_test.ts` - 6 tests: createPlugin, typed state, mountApp runtime routing, PLUG-03 type error, backward compat

## Decisions Made
- **instanceof App discriminator**: `!(appOrPlugin instanceof App)` to detect Plugin at runtime — `'handler' in appInstance` always true (prototype chain traversal), making it unreliable as a discriminator
- **Phantom R via optional field**: `readonly _phantom?: R` — zero runtime cost, satisfies TypeScript type tracking without requiring Effect import in @fresh/core
- **Explicit return type on createPlugin**: `Plugin<Config, S, R>` written out on the function signature — required for JSR slow-types compliance
- **CounterServiceIdentifier = typeof CounterService**: exports the service tag as a type so consumers can write `Plugin<Config, S, CounterServiceIdentifier>` without importing the service value

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plugin<Config, S, R> type is the foundation for Phase 16 (plugin islands / BuildCache aggregation)
- PLUG-03 type safety proven end-to-end for both App and EffectApp host types
- All 10 integration tests pass (8 pre-existing + 2 new PLUG-03)
- `deno publish --dry-run` shows only pre-existing plugin-vite errors (import.meta.hot), no new errors from this phase

---
*Phase: 15-plugin-formal-type*
*Completed: 2026-03-01*
