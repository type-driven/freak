# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Route handlers and Preact islands feel idiomatic in both Fresh and
Effect — no manual runtime wiring, no adapter boilerplate, just Effect returns
where you already write handlers.

**Current focus:** Phase 4 — SSR Atom Hydration (Phase 3 complete, verified)

## Current Position

Phase: 3 of 5 (Preact Atom Hooks)
Plan: 1 of 1 in current phase
Status: Phase complete
Last activity: 2026-02-21 — Completed 03-01-PLAN.md (Preact atom hooks: useAtom, useAtomValue, useAtomSet)

Progress: [██████░░░░] 62% (5/8 total plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: ~4.2 min
- Total execution time: ~21 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 3/3 | 13 min | 4.3 min |
| 02-type-safe-api | 1/1 | 6 min | 6 min |
| 03-preact-atom-hooks | 1/1 | 2 min | 2 min |

**Recent Trend:**
- Last 5 plans: 2 min, 8 min, 6 min, 2 min
- Trend: Fast (Phase 3 well-researched, executed cleanly with no deviations)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Research]: Use duck-typed `EffectLike` structural type — Effect types must
  never appear in `@fresh/core` public exports (JSR constraint)
- [Research]: Build native Preact atom hooks against `preact/hooks` directly —
  `preact/compat` path carries reconciler conflict risk (Fresh issue #1491)
- [Research]: `ManagedRuntime` created once at `effectPlugin()` call time, not
  per-request; disposed via `globalThis.addEventListener("unload", ...)`
- [Research]: Import atoms from `effect/unstable/reactivity/Atom` (v4 core) —
  `@effect-atom/atom` is v3-only and incompatible
- [01-01]: Use `any` (not `unknown`) for `EffectLike` TypeId property — Effect sets
  it to an internal tag, not a user-visible type
- [01-01]: Cast `ctx as Context<unknown>` at resolver call site — `Context<State>` is
  not assignable to `Context<unknown>` due to contravariance on `state` property
- [01-01]: Cast `res as any` after `instanceof Response` guard in `renderRoute` —
  `result: unknown` cannot be narrowed structurally to `PageResponse`; cast is sound
- [01-02]: Use `no-explicit-any` for `ManagedRuntime<any, any>` in createResolver —
  R/E generics erased at resolver boundary; type safety enforced at effectPlugin call site
- [01-02]: `Layer.empty` as default for zero-config `effectPlugin()` — creates functional
  ManagedRuntime with no services; user-supplied Layer overrides
- [01-02]: Inline interface export is sufficient for `EffectPluginOptions` — redundant
  `export type { ... }` re-export causes TS2484; removed
- [01-03]: Use app.route() (not app.get()) for Effect handler integration tests —
  renderRoute() calls _effectResolver; Handler commands (app.get()) bypass renderRoute entirely
- [01-03]: Effect v4 uses ServiceMap.Service instead of Context.Tag for service definition —
  `Context` is not exported from effect@4.0.0-beta.0
- [01-03]: Resolver wraps failure in standard Error with Cause preserved in error.cause —
  Fresh error handling requires Error instances; raw Cause objects produce poor stack traces
- [02-01]: Use ServiceMap.Service.Identifier<typeof Service> for R type parameter in tests —
  `typeof DbService` gives full `Service<I,S>` object; Identifier is what Effect.gen uses as R
- [02-01]: @ts-expect-error for negative type tests must be placed directly above the method
  property (POST:) inside handler object, NOT above the handlers() call site
- [02-01]: expect-type added to plugin-effect deno.json imports (not inline npm: specifiers)
- [02-01]: FakeServer.post() for POST tests — FakeServer has no raw .fetch() method
- [03-01]: Use `registry.mount()` method (returns () => void) not standalone `Atom.mount`
  function (returns Effect) — the interface method is the imperative API for useEffect
- [03-01]: Separate `./island` export entry, not re-exported from mod.ts — island.ts pulls
  in preact which is client-only; server-side imports from `.`, islands import from `./island`
- [03-01]: Module-level AtomRegistry singleton — Fresh islands are separate render roots;
  Preact context does not cross island boundaries; module scope persists across renders
- [03-01]: Sync `registry.get(atom)` before subscribing in useEffect — prevents stale value
  in window between useState initializer (render) and useEffect subscription setup

### Pending Todos

None.

### Blockers/Concerns

- [Phase 1 - RESOLVED]: Verify exact `Effect.EffectTypeId` symbol string from `effect` v4
  source before implementing `isEffect()` detector.
  RESOLUTION: Confirmed `"~effect/Effect"` string key from npm:effect@4.0.0-beta.0; used
  in plugin-effect/src/resolver.ts.
- [Phase 3 - RESOLVED]: Verify `effect/unstable/reactivity/Atom` v4 API surface before
  implementing hooks — `unstable/` prefix means API may differ from v3 docs.
  RESOLUTION: Confirmed API surface at 4.0.0-beta.0; registry.mount() method returns
  () => void (not Effect); subscribe callback receives value directly.
- [Phase 4]: Verify whether v4 atoms support pre-seeded initial values before
  designing serialization protocol.
  NOTE: `AtomRegistry.make({ initialValues: Iterable<[Atom, any]> })` confirmed in
  AtomRegistry.d.ts — SSR seeding is supported via the make() options.
- [Phase 2+]: Integration tests must use app.route() not app.get() when testing
  Effect-returning handlers — Effect resolver runs via renderRoute (RouteCommand path only).
- [Phase 2+]: ServiceMap.Service R type: use ServiceMap.Service.Identifier<typeof Service>
  not `typeof Service` — critical for correct Layer and Effect type matching.
- [Phase 3+]: island_test.ts no-preact/compat test requires --allow-run permission;
  workspace `deno task test` uses `deno test -A` which grants this. Direct `deno test`
  without flags will fail that specific test.

## Session Continuity

Last session: 2026-02-21T19:47:12Z
Stopped at: Completed 03-01-PLAN.md (Preact atom hooks: useAtom, useAtomValue, useAtomSet)
Resume file: None
