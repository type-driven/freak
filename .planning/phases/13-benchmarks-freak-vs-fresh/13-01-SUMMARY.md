---
phase: 13-benchmarks-freak-vs-fresh
plan: 01
subsystem: benchmarks
tags: [benchmarks, fresh, effect, deno, preact, build]

# Dependency graph
requires:
  - phase: 07-fresh-effect-package
    provides: createEffectApp, EffectApp builder pattern
  - phase: 09-rpc-integration
    provides: example app patterns for main.ts/dev.ts structure
provides:
  - Three minimal Fresh apps with identical route structure for apples-to-apples comparison
  - packages/benchmarks scaffold with build tasks
  - Verified builds for all three apps (freak-app, freak-plain-app, upstream-app)
affects:
  - 13-02: benchmark scripts target these three apps

# Tech tracking
tech-stack:
  added:
    - jsr:@fresh/core@2.2.0 (upstream Fresh, exact pin for reproducibility)
  patterns:
    - Builder({ root: import.meta.dirname }) — required when running dev.ts from outside the app directory
    - Benchmark apps registered as explicit workspace members in root deno.json

key-files:
  created:
    - packages/benchmarks/deno.json
    - packages/benchmarks/.gitignore
    - packages/benchmarks/apps/freak-app/deno.json
    - packages/benchmarks/apps/freak-app/main.ts
    - packages/benchmarks/apps/freak-app/dev.ts
    - packages/benchmarks/apps/freak-app/routes/index.tsx
    - packages/benchmarks/apps/freak-app/routes/api/todos.ts
    - packages/benchmarks/apps/freak-app/islands/Counter.tsx
    - packages/benchmarks/apps/freak-app/services/TodoService.ts
    - packages/benchmarks/apps/freak-plain-app/deno.json
    - packages/benchmarks/apps/freak-plain-app/main.ts
    - packages/benchmarks/apps/freak-plain-app/dev.ts
    - packages/benchmarks/apps/freak-plain-app/routes/index.tsx
    - packages/benchmarks/apps/freak-plain-app/routes/api/todos.ts
    - packages/benchmarks/apps/freak-plain-app/islands/Counter.tsx
    - packages/benchmarks/apps/upstream-app/deno.json
    - packages/benchmarks/apps/upstream-app/main.ts
    - packages/benchmarks/apps/upstream-app/dev.ts
    - packages/benchmarks/apps/upstream-app/routes/index.tsx
    - packages/benchmarks/apps/upstream-app/routes/api/todos.ts
    - packages/benchmarks/apps/upstream-app/islands/Counter.tsx
  modified:
    - deno.json (added three benchmark apps as explicit workspace members)
    - deno.lock (added jsr:@fresh/core@2.2.0 upstream dependency)

key-decisions:
  - "Builder({ root: import.meta.dirname }) required — dev.ts run from repo root, not app dir"
  - "Benchmark apps added as explicit workspace members in root deno.json (not via packages/* glob alone)"
  - "freak-app exports effectApp chain (EffectApp); builder auto-unwraps .app in a while loop"
  - "upstream-app pins to jsr:@fresh/core@2.2.0 exactly for reproducible comparison"

patterns-established:
  - "Pattern: import.meta.dirname in Builder root for location-independent dev.ts"
  - "Pattern: Three-way comparison (upstream / freak-plain / freak-effect) isolates Effect overhead"

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 13 Plan 01: Benchmark App Scaffold Summary

**Three minimal Fresh apps (freak-effect, freak-plain, upstream) with identical route structure, all verified to build, enabling apples-to-apples comparison of Effect overhead vs upstream Fresh baseline.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T15:04:40Z
- **Completed:** 2026-02-28T15:08:26Z
- **Tasks:** 2
- **Files modified:** 23 (21 created, 2 modified)

## Accomplishments
- Created three benchmark apps with identical GET /, GET /api/todos, and Counter island
- freak-app uses createEffectApp + Effect.gen handler for /api/todos; TodoService via ServiceMap.Service
- freak-plain-app uses plain App + sync handler (no Effect dependency)
- upstream-app uses jsr:@fresh/core@2.2.0 (exact pin for reproducibility)
- All three apps build successfully to `_fresh/server.js` via `deno run -A dev.ts build`
- packages/benchmarks registered as workspace member; apps added as explicit entries

## Task Commits

Each task was committed atomically:

1. **Task 1: Create three benchmark apps with parity routes** - `ffb10950` (feat)
2. **Task 2: Add benchmarks to workspace and verify all apps build** - `4d2312bb` (chore)

**Plan metadata:** (pending final metadata commit)

## Files Created/Modified
- `packages/benchmarks/deno.json` - Workspace package with bench and build:* tasks
- `packages/benchmarks/.gitignore` - Excludes apps/*/_fresh/ build artifacts
- `packages/benchmarks/apps/freak-app/main.ts` - createEffectApp with TodoLayer
- `packages/benchmarks/apps/freak-app/services/TodoService.ts` - Minimal ServiceMap.Service with list()
- `packages/benchmarks/apps/freak-app/routes/api/todos.ts` - Effect.gen handler yielding TodoService
- `packages/benchmarks/apps/freak-app/islands/Counter.tsx` - Identical across all three apps
- `packages/benchmarks/apps/freak-plain-app/main.ts` - Plain App with staticFiles + fsRoutes
- `packages/benchmarks/apps/freak-plain-app/routes/api/todos.ts` - Sync handler returning JSON
- `packages/benchmarks/apps/upstream-app/deno.json` - Imports from jsr:@fresh/core@2.2.0
- `deno.json` - Added three app paths as explicit workspace members

## Decisions Made
- **Builder root via import.meta.dirname:** dev.ts files are run from the repo root (e.g., `deno run -A packages/benchmarks/apps/freak-app/dev.ts build`). Without `root: import.meta.dirname`, Builder defaults to `Deno.cwd()` and writes `_fresh/` to the repo root. Setting `root` explicitly fixes this.
- **Apps as explicit workspace members:** The `./packages/*` glob in root deno.json covers `packages/benchmarks` itself, but not the nested apps in `packages/benchmarks/apps/`. Each app needs its own entry in the workspace array so Deno resolves their import maps (especially `@fresh/core` → local vs JSR path).
- **No exports field in benchmark deno.json:** These are not publishable packages; the "exports field required with name" warning is benign.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Builder root defaulted to wrong directory when run from repo root**
- **Found during:** Task 2 (build verification)
- **Issue:** `new Builder({ target: "safari12" })` uses `Deno.cwd()` as root. Running from the repo root caused `_fresh/` to be created at `/path/to/freak/_fresh` instead of in the app directory.
- **Fix:** Added `root: import.meta.dirname` to all three `dev.ts` Builder constructors.
- **Files modified:** packages/benchmarks/apps/{freak-app,freak-plain-app,upstream-app}/dev.ts
- **Verification:** Build output confirmed at correct location (`packages/benchmarks/apps/freak-app/_fresh/server.js`)
- **Committed in:** `4d2312bb` (Task 2 commit)

**2. [Rule 3 - Blocking] Apps not recognized as workspace members without explicit entries**
- **Found during:** Task 2 (first build attempt)
- **Issue:** Deno 2 requires each config file to be a member of the workspace. The `./packages/*` glob in root `deno.json` does NOT recursively cover `packages/benchmarks/apps/*/deno.json`.
- **Fix:** Added three explicit entries (`./packages/benchmarks/apps/freak-app`, etc.) to root `deno.json` workspace array.
- **Files modified:** deno.json
- **Verification:** `deno run -A ...dev.ts build` exits 0 for all three apps
- **Committed in:** `4d2312bb` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking)
**Impact on plan:** Both fixes required for the build to work correctly. No scope creep.

## Issues Encountered
- First build attempt (without workspace entries) gave "Config file must be a member of the workspace" error — resolved by adding explicit workspace entries.
- Second build attempt (without root) wrote `_fresh/` to repo root — resolved by passing `root: import.meta.dirname`.

## Next Phase Readiness
- All three benchmark apps are scaffold-complete and build successfully
- Plan 02 (benchmark scripts) can immediately target these apps at ports 8001/8002/8003
- Build tasks in `packages/benchmarks/deno.json` provide `build:freak`, `build:freak-plain`, `build:upstream`, `build:all`
- No blockers

---
*Phase: 13-benchmarks-freak-vs-fresh*
*Completed: 2026-02-28*
