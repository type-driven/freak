---
phase: 04-atom-hydration
plan: 02
subsystem: hydration
tags: [
  effect,
  atoms,
  ssr,
  hydration,
  client-side,
  preact,
  island,
  serialization,
]

# Dependency graph
requires:
  - phase: 04-01
    provides: __FRSH_ATOM_STATE script tag emission and serializeAtomHydration() pipeline
  - phase: 03-preact-atom-hooks
    provides: island.ts registry singleton used as client-side atom store
provides:
  - initAtomHydration() export in island.ts for manual/test seeding
  - Module-level auto-init in island.ts reads __FRSH_ATOM_STATE at import time
  - _hydratedKeys Set for orphan detection infrastructure
  - _checkOrphanedKeys() no-op export (deferred active detection)
  - 10 client-side hydration tests in hydration_client_test.ts
affects:
  - phase 05: end-to-end hydration usage; island components use useAtomValue with no loading flash

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Module-level code in island.ts runs before boot() -- timing guarantee for pre-seeding
    - initAtomHydration(serialized?) overloaded for DOM-read (no arg) and test/explicit (string arg)
    - setSerializable(key, encoded) called for each JSON entry -- decodes on first registry.get()
    - Graceful degradation: silent skip on malformed JSON in auto-init; console.warn in explicit call

key-files:
  created:
    - packages/plugin-effect/tests/hydration_client_test.ts
  modified:
    - packages/plugin-effect/src/island.ts

key-decisions:
  - "Module-level auto-init in island.ts is sufficient -- no boot script modification needed; ES module import time is before boot()"
  - "_hydratedKeys Set added at module scope BEFORE registry creation so auto-init and initAtomHydration() share it"
  - "initAtomHydration() accepts optional serialized string for test use; omitting reads from DOM"
  - "_checkOrphanedKeys() is a no-op export -- active orphan detection deferred pending AtomRegistry instrumentation"
  - "Auto-init silently skips malformed JSON; explicit initAtomHydration() emits console.warn for developer visibility"

patterns-established:
  - "Client hydration pattern: module-level auto-init + explicit export for testing (dual-mode initAtomHydration)"
  - "Round-trip test pattern: server serializeAtomHydration() -> JSON -> client registry.setSerializable() -> registry.get(atom)"

# Metrics
duration: 2min
completed: 2026-02-23
---

# Phase 4 Plan 02: Client-Side Atom Hydration Summary

**Module-level auto-init in island.ts reads __FRSH_ATOM_STATE at import time and
calls registry.setSerializable(key, encoded), completing the SSR hydration
pipeline with no loading flash on first render**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-23T22:12:36Z
- **Completed:** 2026-02-23T22:14:50Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified + 1 created)

## Accomplishments

- `initAtomHydration(serialized?)` exported from island.ts -- accepts optional
  JSON string for test use; reads from DOM when omitted
- Module-level auto-init block in island.ts reads
  `document.getElementById("__FRSH_ATOM_STATE")` at import time (before `boot()`
  calls `revive()`)
- `_hydratedKeys` Set and `_checkOrphanedKeys()` no-op provide orphan detection
  infrastructure (deferred active detection)
- 10 client-side tests cover: setSerializable behavior, isSerializable checks,
  full round-trip, error handling
- 64 total tests pass (plugin-effect) + 343 Fresh tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: initAtomHydration and module-level auto-init in island.ts** -
   `3b4a2f78` (feat)
2. **Task 2: Client-side hydration tests** - `a9a66a5a` (test)

**Plan metadata:** (pending)

## Files Created/Modified

- `packages/plugin-effect/src/island.ts` - Added `_hydratedKeys`, module-level
  auto-init block, `initAtomHydration()`, `_checkOrphanedKeys()`; all existing
  hooks unchanged
- `packages/plugin-effect/tests/hydration_client_test.ts` - New: 10 tests
  covering setSerializable, isSerializable, round-trip, error handling

## Decisions Made

- Module-level code in island.ts runs at ES module import time, which happens
  before `boot()` calls `revive()` -- no boot script modification needed
- `_hydratedKeys` Set declared before `registry` so both auto-init and
  `initAtomHydration()` reference the same Set
- `initAtomHydration()` dual-mode: no arg reads from DOM (production), string
  arg for test/explicit injection
- Auto-init silently skips malformed JSON; the explicit export warns via
  `console.warn` for developer visibility
- Active orphan detection deferred -- would require AtomRegistry instrumentation
  not yet available

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Full SSR atom hydration pipeline complete (both phases 04-01 and 04-02)
- Server: `setAtom(ctx, atom, value)` encodes and stores in per-request map
- Server: `FreshRuntimeScript` emits
  `<script id="__FRSH_ATOM_STATE" type="application/json">` before the module
  script tag
- Client: island.ts auto-init reads the script tag at import time and calls
  `registry.setSerializable(key, encoded)`
- Result: `useAtomValue(atom)` returns server-hydrated value on first render (no
  loading flash)
- Phase 05 can build end-to-end examples demonstrating the full pipeline

---

_Phase: 04-atom-hydration_ _Completed: 2026-02-23_
