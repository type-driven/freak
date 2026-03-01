---
phase: 16-islands-in-plugins
plan: 01
subsystem: testing
tags: [fresh, plugin, islands, preact, jsx, ssr, buildcache, createPlugin, mountApp]

# Dependency graph
requires:
  - phase: 15-plugin-formal-type
    provides: Plugin<Config,S,R> interface and createPlugin() factory used in test fixtures
  - phase: 14-typed-app-composition
    provides: mountApp island merge path (app.ts lines 421-423) being formally tested
provides:
  - Formal requirement tests for plugin island integration (ISLD-01, ISLD-02, ISLD-03)
  - Verified that createPlugin() + mountApp() + app.islands() reaches host BuildCache
  - Verified SSR frsh:island markers appear with correct export names for plugin islands
  - Verified no collision when two plugins use same-named component export (distinct refs)
affects:
  - 17-demo-app (builds on verified plugin islands; can rely on these tests as regression guard)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plugin island test pattern: createPlugin → mountApp → setBuildCache → assert islandRegistry"
    - "Plugin SSR test pattern: plugin route with ctx.render + island → host.handler() → assert html contains frsh:island"

key-files:
  created:
    - packages/fresh/tests/plugin_islands_test.tsx
  modified: []

key-decisions:
  - "No source changes needed — feature already implemented in app.ts mountApp island merge (lines 421-423) and build_cache.ts IslandPreparer; Phase 16 plan 01 is tests-only"
  - "ISLD-03 collision prevention tested via two distinct function references with same export name string — BuildCache keyed on ComponentType (function ref), so distinct refs = no collision"
  - "frsh:island markers use component export name (not chunk name) — asserted on entry.exportName and HTML content"

patterns-established:
  - "Plugin test fixtures: simple JSX functions at top of file (CounterIsland, GreetIsland, CounterIsland2)"
  - "Island SSR test flow: createPlugin → host.mountApp → setBuildCache(host, cache) → host.handler() → fetch route → assert html"

# Metrics
duration: 1min
completed: 2026-03-01
---

# Phase 16 Plan 01: Plugin Islands Requirement Tests Summary

**Five ISLD-0x tests proving that Plugin<Config,S,R> islands reach the host BuildCache, produce SSR markers, and avoid name collisions — no production source changes needed**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-01T21:23:34Z
- **Completed:** 2026-03-01T21:24:25Z
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments
- Created `packages/fresh/tests/plugin_islands_test.tsx` with 5 tests covering ISLD-01, ISLD-02, ISLD-03
- Confirmed no production source changes required — island aggregation was already implemented in Phase 14
- All 5 new tests pass; all 19 regression tests pass (plugin_test.ts, islands_test.ts, islands_ssr_demo_test.tsx)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create plugin_islands_test.tsx with ISLD-01, ISLD-02, ISLD-03 tests** - `c7823435` (test)

**Plan metadata:** _(pending — included in final commit)_

## Files Created/Modified
- `packages/fresh/tests/plugin_islands_test.tsx` - 5 formal requirement tests for plugin island integration (ISLD-01, ISLD-02, ISLD-03); JSX test file with fixture components CounterIsland, GreetIsland, CounterIsland2

## Decisions Made
- No production source changes needed — `app.ts` mountApp already merges island registrations (lines 421-423) and `build_cache.ts` IslandPreparer already handles aggregation; Phase 16 plan 01 is tests-only
- ISLD-03 collision scenario tested with two distinct function references both named "CounterIsland" via `{ CounterIsland: CounterIsland2 }` re-export syntax — BuildCache keys on ComponentType (function ref), so distinct refs never collide regardless of export name
- frsh:island SSR markers assert the component export name string (e.g., "CounterIsland"), not the chunk name — matches actual Fresh behavior confirmed in islands_ssr_demo_test.tsx

## Deviations from Plan

None - plan executed exactly as written. Research had correctly identified that no production source changes were needed.

## Issues Encountered

None. Tests passed on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 16 plan 01 complete — ISLD-01, ISLD-02, ISLD-03 formally verified
- Phase 17 demo app can build on top of this verified foundation
- No blockers or concerns

---
*Phase: 16-islands-in-plugins*
*Completed: 2026-03-01*
