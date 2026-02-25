# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Route handlers and Preact islands feel idiomatic in both Fresh and
Effect — no manual runtime wiring, no adapter boilerplate, just Effect returns
where you already write handlers.

**Current focus:** Milestone v2 — Effect-First Handlers, HttpApi & RPC (Phase 7 complete, ready for Phase 8)

## Current Position

Phase: 7 of 10 (Fresh Effect Package) — complete
Plan: 2/2 in current phase
Status: Phase 7 complete — all 4 success criteria verified, ready for Phase 8
Last activity: 2026-02-25 — Completed 07-02-PLAN.md (@fresh/effect test suite + example app conversion)

Progress: [███████░░░] 70% — v1 complete (9/9 plans); v2 Phase 6 complete (2/2 plans); Phase 7 complete (2/2 plans)

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
| 07-fresh-effect-package | 2/2 | 7 min | 3.5 min |
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
- [07-02]: @ts-expect-error for app.get() type rejection: use typed variable pattern (const x: Parameters<typeof app.get>[1] = ...) so directive aligns with error line
- [07-02]: Deno ChildProcess streams must be cancelled after cp.status to avoid resource leak errors: await cp.stdout.cancel() + cp.stderr.cancel()
- [07-02]: signal_server.ts uses port:0 + onListen callback for subprocess readiness handshake (READY:<port>)

### Pending Todos

- Plan and execute Phase 8: HttpApi integration
- Plan and execute Phase 9: RPC integration
- Plan and execute Phase 10: Migration example
- Plan Phase 11: micro-app architecture (mountApp issues + Module Federation research)

### Roadmap Evolution

- Phase 11 added (2026-02-25): Micro-App Architecture — research mountApp issues, evaluate Module Federation (https://github.com/module-federation/vite#readme), architectural decision for Freak app composition

### Blockers/Concerns

- Pre-existing test failures (51/~83 tests) due to missing `--allow-env` Deno permissions (not caused by v2 work)
- Phase 8 needs to define EffectApp.build() API — not yet implemented in @fresh/effect

## Session Continuity

Last session: 2026-02-25T21:59:32Z
Stopped at: Completed 07-02-PLAN.md — @fresh/effect test suite + example app conversion (all 4 SC verified)
Resume file: None
