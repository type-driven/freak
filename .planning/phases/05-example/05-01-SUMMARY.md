---
phase: 05-example
plan: 01
subsystem: example
tags: [effect, fresh, deno-kv, todo, service-layer, atoms, hydration, tailwind, scaffold]

# Dependency graph
requires:
  - phase: 04-atom-hydration
    provides: Atom.serializable + setAtom + initAtomHydration hydration pipeline
  - phase: 03-preact-atom-hooks
    provides: useAtom/useAtomValue/useAtomSet hooks in island.ts
  - phase: 01-foundation
    provides: effectPlugin, createEffectDefine, ManagedRuntime wiring
  - phase: 02-type-safe-api
    provides: typed handler definitions with createEffectDefine
provides:
  - Standalone example app scaffold in packages/examples/effect-integration/
  - deno.json with imports, compilerOptions, tasks
  - dev.ts Builder + tailwind entry point
  - main.ts App assembled with effectPlugin({ layer: AppLayer })
  - types.ts TodoSchema and Todo type
  - services/errors.ts KvError and NotFoundError tagged errors
  - services/TodoService.ts ServiceMap.Service + TodoLayer wrapping Deno.openKv()
  - services/layers.ts AppLayer = TodoLayer
  - atoms.ts serializable todoListAtom (key: "todo-list")
  - static/styles.css Tailwind CSS entry point
  - routes/_app.tsx HTML shell with Tailwind link
affects:
  - phase 05 plan 02: routes and islands build on top of this foundation

# Tech tracking
tech-stack:
  added:
    - effect v4.0.0-beta.0 (ServiceMap.Service, Layer.effect, Data.TaggedError, Schema)
    - preact v10.28.3 (JSX, island runtime)
    - tailwindcss v4.1.10 (utility CSS)
    - @fresh/plugin-effect (effectPlugin, setAtom)
    - @fresh/plugin-tailwind (tailwind(builder))
  patterns:
    - ServiceMap.Service for Effect v4 service definition (not Context.Tag)
    - Layer.effect for async service initialization (Deno.openKv())
    - Data.TaggedError for typed domain errors (KvError, NotFoundError)
    - Effect.tryPromise for wrapping KV promise APIs
    - Atom.serializable with Schema.mutable(Schema.Array(...)) for mutable array atoms
    - effectPlugin({ layer: AppLayer }) wired in main.ts WITHOUT mapError
    - Failures propagate to Fresh _error.tsx via standard Error with Cause in error.cause

key-files:
  created:
    - packages/examples/effect-integration/deno.json
    - packages/examples/effect-integration/dev.ts
    - packages/examples/effect-integration/main.ts
    - packages/examples/effect-integration/types.ts
    - packages/examples/effect-integration/services/errors.ts
    - packages/examples/effect-integration/services/TodoService.ts
    - packages/examples/effect-integration/services/layers.ts
    - packages/examples/effect-integration/atoms.ts
    - packages/examples/effect-integration/static/styles.css
    - packages/examples/effect-integration/routes/_app.tsx
  modified:
    - deno.json (added packages/examples/effect-integration to workspace array)

key-decisions:
  - "Added packages/examples/effect-integration to root workspace array -- Deno 2.6.9 requires nested deno.json to be workspace member even for standalone apps"
  - "Used direct file paths in import map (../../plugin-effect/src/mod.ts) instead of directory references -- directory trailing-slash imports fail in this workspace configuration"
  - "effectPlugin({ layer: AppLayer }) wired WITHOUT mapError -- failures propagate to Fresh _error.tsx via standard Error with Cause preserved in error.cause"
  - "Schema.mutable(Schema.Array(TodoSchema)) for todoListAtom schema -- Atom.serializable requires Codec<Type<R>, any> where Type<R> is Todo[] (mutable); plain Schema.Array gives readonly Todo[]"
  - "NotFoundError re-thrown in toggle/remove catch handler -- Effect.tryPromise catch receives both Error and NotFoundError; instanceof check preserves typed error identity"

patterns-established:
  - "Effect v4 service layer: ServiceMap.Service<Shape>(key) + Layer.effect(Service, Effect.tryPromise(...))"
  - "Standalone example in workspace: deno.json with explicit file path imports to sibling packages"
  - "Serializable atom for array: Atom.make<T[]>([]) + Atom.serializable({ schema: Schema.mutable(Schema.Array(TSchema)) })"

# Metrics
duration: 5min
completed: 2026-02-24
---

# Phase 5 Plan 01: Effect Integration Example Scaffold Summary

**Standalone example app scaffold with TodoService backed by Deno.openKv(),
effectPlugin wired to AppLayer without mapError, and serializable todoListAtom
ready for SSR hydration in Plan 02**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-24T09:33:06Z
- **Completed:** 2026-02-24T09:39:00Z
- **Tasks:** 2
- **Files modified:** 11 (10 created + 1 modified root deno.json)

## Accomplishments

- `packages/examples/effect-integration/` directory structure created with all
  scaffold files
- `deno.json`: standalone app config with imports pointing to local plugin
  packages, jsxPrecompileSkipElements, tasks (dev/build/start)
- `dev.ts`: Builder + tailwind(builder) entry point following www/dev.ts pattern
- `main.ts`: App with effectPlugin({ layer: AppLayer }), staticFiles(),
  fsRoutes() -- NO mapError
- `types.ts`: TodoSchema (Schema.Struct with id/text/done) and Todo type
- `services/errors.ts`: KvError and NotFoundError as Data.TaggedError
- `services/TodoService.ts`: ServiceMap.Service with list/create/toggle/remove
  operations backed by Deno.openKv() via Layer.effect
- `services/layers.ts`: AppLayer = TodoLayer
- `atoms.ts`: todoListAtom as Atom.serializable with key "todo-list" and
  Schema.mutable(Schema.Array(TodoSchema))
- `static/styles.css`: @import "tailwindcss"
- `routes/_app.tsx`: HTML shell with Tailwind stylesheet link and bg-gray-50
  body
- All files pass `deno check`

## Task Commits

Each task was committed atomically:

1. **Task 1: Project scaffold and service layer** - `8d487b97` (feat)
2. **Task 2: Atoms, static assets, and app shell** - `3343d941` (feat)

## Files Created/Modified

- `deno.json` (root) - Added `packages/examples/effect-integration` to workspace
  array
- `packages/examples/effect-integration/deno.json` - Standalone app config with
  explicit file imports
- `packages/examples/effect-integration/dev.ts` - Builder listen entry point
- `packages/examples/effect-integration/main.ts` - App assembly with
  effectPlugin
- `packages/examples/effect-integration/types.ts` - TodoSchema + Todo type
- `packages/examples/effect-integration/services/errors.ts` - KvError,
  NotFoundError
- `packages/examples/effect-integration/services/TodoService.ts` - TodoService +
  TodoLayer
- `packages/examples/effect-integration/services/layers.ts` - AppLayer
- `packages/examples/effect-integration/atoms.ts` - todoListAtom
- `packages/examples/effect-integration/static/styles.css` - Tailwind import
- `packages/examples/effect-integration/routes/_app.tsx` - App shell

## Decisions Made

- Deno 2.6.9 requires nested deno.json configs to be workspace members -- added
  example to root workspace array (plan said not to, but Deno enforces this at
  the toolchain level)
- Used direct file paths (`../../plugin-effect/src/mod.ts`) in import map
  because directory-trailing-slash references fail to resolve with local
  workspace packages
- effectPlugin wired WITHOUT mapError -- effect failures propagate as standard
  Error with Cause in error.cause to Fresh's _error.tsx
- `Schema.mutable(Schema.Array(TodoSchema))` required for atom schema because
  `Atom.serializable` constraint `S extends Codec<Type<R>, any>` requires
  mutable array type to match `Atom<Todo[]>`
- TodoLayer uses single `Deno.openKv()` call via `Layer.effect` (opened once at
  layer build time, reused per request)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added packages/examples/effect-integration to root
workspace**

- **Found during:** Task 1 verification (deno check)
- **Issue:** Deno 2.6.9 rejects nested deno.json configs that aren't workspace
  members: "Config file must be a member of the workspace." The plan said NOT to
  add to workspace, but Deno enforces this at the toolchain level.
- **Fix:** Added `"./packages/examples/effect-integration"` to root deno.json
  workspace array
- **Files modified:** `deno.json` (root)
- **Commit:** `8d487b97`

**2. [Rule 3 - Blocking] Used direct file paths in import map instead of
directory references**

- **Found during:** Task 1 verification (deno check)
- **Issue:** The plan specified `"@fresh/plugin-effect": "../plugin-effect/"`
  (directory trailing slash). As a workspace member, directory references failed
  to resolve to the package entry point.
- **Fix:** Changed to explicit file paths:
  `"@fresh/plugin-effect": "../../plugin-effect/src/mod.ts"` and
  `"@fresh/plugin-tailwind": "../../plugin-tailwindcss/src/mod.ts"`
- **Files modified:** `packages/examples/effect-integration/deno.json`
- **Commit:** `8d487b97`

**3. [Rule 1 - Bug] Schema.mutable() wrapper required for array atom schema**

- **Found during:** Task 2 verification (deno check atoms.ts)
- **Issue:** `Schema.Array(TodoSchema)` produces `readonly Todo[]` as its Type.
  `Atom.serializable` constraint requires `S extends Codec<Type<R>, any>` where
  the atom is `Atom<Todo[]>` (mutable). Readonly array is not assignable to
  mutable.
- **Fix:** Changed to `Schema.mutable(Schema.Array(TodoSchema))`
- **Files modified:** `packages/examples/effect-integration/atoms.ts`
- **Commit:** `3343d941`

## Issues Encountered

- Plan specified relative paths `"../plugin-effect/"` which are wrong for the
  directory depth (`packages/examples/effect-integration/` is 2 levels deep, not
  1). Corrected to `"../../plugin-effect/src/mod.ts"`.
- Plan specified `"exports"` field not present in deno.json initially (only
  `"name"` without `"exports"` triggers Deno warning). Added
  `"exports": "./main.ts"` to silence the warning.

## User Setup Required

None - no external service configuration required. Deno KV is built into Deno
and requires no setup.

## Next Phase Readiness

- Foundation is solid: effectPlugin wired, AppLayer ready, types defined
- Plan 02 can immediately build routes (`routes/index.tsx`,
  `routes/api/todos.ts`) using `createEffectDefine<AppState, TodoServiceR>()`
- `setAtom(ctx, todoListAtom, todos)` can be called from route handlers
  (requires import from `@fresh/plugin-effect`)
- Island (`islands/TodoApp.tsx`) can import from `@fresh/plugin-effect/island`
  and use `useAtom(todoListAtom)`
- Error page (`routes/_error.tsx`) can demonstrate `Cause.pretty()` server-side
  logging

---

_Phase: 05-example_ _Completed: 2026-02-24_
