# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Route handlers and Preact islands feel idiomatic in both Fresh and
Effect — no manual runtime wiring, no adapter boilerplate, just Effect returns
where you already write handlers.

**Current focus:** Phase 1 — Foundation (COMPLETE)

## Current Position

Phase: 1 of 5 (Foundation)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-02-18 — Completed 01-03-PLAN.md (tests + resolver refinement)

Progress: [████░░░░░░] 20%

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: 4.3 min
- Total execution time: 13 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 3/3 | 13 min | 4.3 min |

**Recent Trend:**
- Last 5 plans: 3 min, 2 min, 8 min
- Trend: Stable

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

### Pending Todos

None.

### Blockers/Concerns

- [Phase 1 - RESOLVED]: Verify exact `Effect.EffectTypeId` symbol string from `effect` v4
  source before implementing `isEffect()` detector.
  RESOLUTION: Confirmed `"~effect/Effect"` string key from npm:effect@4.0.0-beta.0; used
  in plugin-effect/src/resolver.ts.
- [Phase 3]: Verify `effect/unstable/reactivity/Atom` v4 API surface before
  implementing hooks — `unstable/` prefix means API may differ from v3 docs.
- [Phase 4]: Verify whether v4 atoms support pre-seeded initial values before
  designing serialization protocol.
- [Phase 2+]: Integration tests must use app.route() not app.get() when testing
  Effect-returning handlers — Effect resolver runs via renderRoute (RouteCommand path only).

## Session Continuity

Last session: 2026-02-18T22:50:48Z
Stopped at: Completed 01-03-PLAN.md (Phase 1 complete)
Resume file: None
