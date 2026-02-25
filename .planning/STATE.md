# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Route handlers and Preact islands feel idiomatic in both Fresh and
Effect — no manual runtime wiring, no adapter boilerplate, just Effect returns
where you already write handlers.

**Current focus:** Milestone v2 — Effect-First Handlers, HttpApi & RPC (Phase 7 in progress — Plan 1 complete)

## Current Position

Phase: 7 of 10 (Fresh Effect Package) — in progress
Plan: 1/TBD in current phase
Status: In progress — Plan 1 complete, ready for Plan 02 (tests)
Last activity: 2026-02-25 — Completed 07-01-PLAN.md (@fresh/effect package core API created)

Progress: [██████░░░░] 60% — v1 complete (9/9 plans); v2 Phase 6 complete (2/2 plans); Phase 7 Plan 1 complete

## Performance Metrics

**Velocity (v1):**
- Total plans completed: 9
- Average duration: ~4.2 min
- Total execution time: ~38 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 3/3 | 13 min | 4.3 min |
| 02-type-safe-api | 1/1 | 6 min | 6 min |
| 03-preact-atom-hooks | 1/1 | 2 min | 2 min |
| 04-atom-hydration | 2/2 | 8 min | 4 min |
| 05-example | 2/2 | 10 min | 5 min |
| 06-fresh-core-plumbing | 2/2 | 12 min | 6 min |
| 07-fresh-effect-package | 1/TBD | 3 min | 3 min |
| 08-httpapi-integration | 0/TBD | — | — |
| 09-rpc-integration | 0/TBD | — | — |
| 10-migration-example | 0/TBD | — | — |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [05-02]: In-memory Map for TodoService instead of Deno KV — simpler, no external dependencies
- [05-02]: Resolver default throws HttpError(500) with Cause in error.cause — enters Fresh error chain
- [05-02]: Example app mapError maps NotFoundError → HttpError(404) — bypasses Fresh dev overlay
- [05-02]: HttpError < 500 flows through segment error handler to _error.tsx without dev overlay
- [v2-design]: `EffectApp<State, AppR>` wraps `App<State>` — Fresh routing untouched, Effect owns lifecycle
- [v2-design]: HttpApi + RPC both accumulate layers in `EffectApp.build()` → single `HttpRouter.toWebHandler` sub-handler
- [v2-design]: AbortController replaces Deno `unload` event for runtime lifecycle — wires to SIGTERM/SIGINT
- [v2-design]: `@fresh/plugin-effect` becomes a compat shim re-exporting from `@fresh/effect`
- [06-01]: EffectRunner type defined in handlers.ts (not app.ts) — avoids circular import via app.ts->commands.ts->segments.ts
- [06-01]: commands.ts applyCommands/applyCommandsInner thread effectRunner through all renderRoute closures
- [06-01]: isEffectLike and EffectRunner added to public mod.ts API for Phase 7 EffectApp use
- [06-02]: effectPlugin signature changed to effectPlugin(app, opts?) — app-first enables per-app isolation without global state
- [06-02]: createEffectDefine standalone path requires app as first arg when layer provided — throws descriptive error if called without app
- [06-02]: Type casts used in SC-2/SC-3 tests for app.get()/app.use() Effect returns — type-level EffectLike support deferred to Phase 7
- [07-01]: createEffectDefine in @fresh/effect is type-only (no app/layer args) — runtime is EffectApp's job
- [07-01]: registerSignalDisposal uses Deno.addSignalListener (SIGINT/SIGTERM) not globalThis.addEventListener('unload')
- [07-01]: setEffectRunner cast to App<any> needed due to State type variance in BuildCache — safe at runtime
- [07-01]: EffectApp.mountApp accepts App<State> not EffectApp — plain App for micro-app composition

### Pending Todos

- Run Phase 7 Plan 02: integration tests for createEffectApp
- Run Phase 7 Plan 03+ (if any): additional @fresh/effect features
- Plan Phase 11: micro-app architecture (mountApp issues + Module Federation research)

### Roadmap Evolution

- Phase 11 added (2026-02-25): Micro-App Architecture — research mountApp issues, evaluate Module Federation (https://github.com/module-federation/vite#readme), architectural decision for Freak app composition

### Blockers/Concerns

- Pre-existing test failures (51/~83 tests) due to missing `--allow-env` Deno permissions (not caused by v2 work)
- Type gap RESOLVED: EffectApp proxies app.get()/app.use() with Effect-typed middleware signatures — no casts needed when using EffectApp (casts still needed if using raw App directly)
- Pre-existing test failures (51/~83 tests) due to missing `--allow-env` Deno permissions (not caused by v2 work)

## Session Continuity

Last session: 2026-02-25T21:51:03Z
Stopped at: Completed 07-01-PLAN.md — @fresh/effect package core API created (EffectApp, createEffectApp, createEffectDefine)
Resume file: None
