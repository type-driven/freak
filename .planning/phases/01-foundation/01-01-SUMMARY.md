---
phase: 01-foundation
plan: 01
subsystem: api
tags: [effect, fresh, deno, typescript, duck-typing, plugin-hooks]

# Dependency graph
requires: []
provides:
  - EffectLike<A> structural interface in @fresh/core public API (handlers.ts, mod.ts)
  - setEffectResolver() registration hook in @fresh/core/internal (segments.ts, internals.ts)
  - renderRoute() calls _effectResolver after fn(ctx) when resolver is registered
affects:
  - 01-02 (effect-plugin package uses setEffectResolver from @fresh/core/internal)
  - 01-03 (plugin-effect builds on top of this hook)
  - All future phases using Effect in route handlers

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Duck-typed structural interface (EffectLike) to avoid npm:effect in Fresh core
    - Null-initialized module-level hook pattern for optional plugin registration
    - unknown cast via explicit result variable to handle union type expansion

key-files:
  created: []
  modified:
    - packages/fresh/src/handlers.ts
    - packages/fresh/src/mod.ts
    - packages/fresh/src/segments.ts
    - packages/fresh/src/internals.ts

key-decisions:
  - "Use any (not unknown) for EffectLike TypeId property — Effect sets it to internal tag, not a useful type"
  - "Cast ctx as Context<unknown> at resolver call site — Context<State> is not assignable to Context<unknown> due to contravariance"
  - "Cast res to any as pageRes after instanceof Response guard — result: unknown requires explicit cast for PageResponse property access"

patterns-established:
  - "Hook pattern: module-level nullable callback (let _resolver = null) + set function exported via /internal"
  - "EffectLike structural typing: use string literal TypeId key, not npm:effect import"

# Metrics
duration: 3min
completed: 2026-02-18
---

# Phase 1 Plan 1: Fresh Core Effect Hook Points Summary

**EffectLike<A> duck-type interface and setEffectResolver() plugin hook wired into HandlerFn and renderRoute() — zero npm:effect dependency in @fresh/core**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-18T22:29:40Z
- **Completed:** 2026-02-18T22:32:48Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `EffectLike<A>` structural interface added to `handlers.ts` and exported from `mod.ts` public API
- `HandlerFn` return union extended with `EffectLike<Response | PageResponse<Data>>`
- `setEffectResolver()` function added to `segments.ts` with module-level `_effectResolver` variable
- `renderRoute()` calls `_effectResolver` after `fn(ctx)` when a resolver is registered; no behavior change when resolver is null
- `setEffectResolver` re-exported from `internals.ts` for `@fresh/core/internal` consumers
- `deno publish --dry-run --allow-dirty` passes — no Effect types leak into public API
- All 5 existing `segments_test.ts` tests pass unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add EffectLike structural type and extend HandlerFn** - `d37b23b9` (feat)
2. **Task 2: Add setEffectResolver hook to segments.ts and wire into renderRoute** - `9abd1766` (feat)

## Files Created/Modified

- `packages/fresh/src/handlers.ts` - Added `EffectLike<A>` interface; extended `HandlerFn` return union
- `packages/fresh/src/mod.ts` - Added `type EffectLike` to public re-exports
- `packages/fresh/src/segments.ts` - Added `_effectResolver` variable, `setEffectResolver()` function, and resolver call in `renderRoute()`
- `packages/fresh/src/internals.ts` - Added `setEffectResolver` re-export for `@fresh/core/internal`

## Decisions Made

- Used `any` (not `unknown`) for the `EffectLike` TypeId property value — Effect sets this to an internal tag identifier, not a user-visible type, so `unknown` would be misleading.
- At the `_effectResolver` call site, cast `ctx as Context<unknown>` — TypeScript rejects `Context<State>` as `Context<unknown>` due to contravariance on the `state` property. The cast is safe because the resolver treats `ctx` opaquely.
- After the `instanceof Response` guard in `renderRoute`, cast `res as any` to `pageRes` for `PageResponse` property access — once `result: unknown` is used, TypeScript cannot narrow `unknown` to `PageResponse<unknown>` via structural checks alone. The cast is sound because at that branch `res` can only be a `PageResponse` or resolved Effect output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type errors in segments.ts from EffectLike union expansion**

- **Found during:** Task 1 (after extending HandlerFn return type)
- **Issue:** Adding `EffectLike<...>` to the `HandlerFn` return union caused TypeScript to flag `res.status`, `res.headers`, and `res.data` accesses in `renderRoute()` as errors — `EffectLike` has none of those properties, so the narrowed union after `instanceof Response` no longer permitted them.
- **Fix:** Changed `return await fn(ctx)` to `let result: unknown = await fn(ctx)` (Task 2's change, done inline), and cast `res as any` to `pageRes` for post-instanceof property accesses. This is sound: at that code path `res` is guaranteed to be a `PageResponse` or a resolver-unwrapped value.
- **Files modified:** `packages/fresh/src/segments.ts`
- **Verification:** `deno check packages/fresh/src/handlers.ts` passes; all segments_test.ts pass.
- **Committed in:** `9abd1766` (Task 2 commit)

**2. [Rule 3 - Blocking] Context<State> not assignable to Context<unknown> at resolver call**

- **Found during:** Task 2 (implementing resolver call in renderRoute)
- **Issue:** `_effectResolver` signature takes `Context<unknown>`, but `renderRoute<State>` has `ctx: Context<State>`. TypeScript rejects the assignment due to `State` covariance/contravariance on the `state` property type.
- **Fix:** Added `ctx as Context<unknown>` cast at the call site. Safe — the resolver uses `ctx` opaquely.
- **Files modified:** `packages/fresh/src/segments.ts`
- **Verification:** `deno check packages/fresh/src/segments.ts` passes.
- **Committed in:** `9abd1766` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 type narrowing bug from union expansion, 1 type-variance blocker)
**Impact on plan:** Both fixes were necessary for compilation correctness. No scope creep — all changes are within the four planned files.

## Issues Encountered

Both deviations arose from the TypeScript type system's handling of the new `EffectLike` union member and the `Context<State>` variance constraint. They were resolved inline during task execution without requiring architectural changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Hook points are in place: `@fresh/core` public API exports `EffectLike`, `@fresh/core/internal` exports `setEffectResolver`
- Plan 02 (plugin-effect package) can now call `setEffectResolver()` at plugin setup time and return a resolver that runs Effects via `ManagedRuntime`
- No blockers for Plan 02

---
*Phase: 01-foundation*
*Completed: 2026-02-18*
