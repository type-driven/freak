# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Route handlers and Preact islands feel idiomatic in both Fresh and
Effect — no manual runtime wiring, no adapter boilerplate, just Effect returns
where you already write handlers.

**Current focus:** Milestone v2 — Effect-First Handlers, HttpApi & RPC (Phase 6 next)

## Current Position

Phase: 6 of 10 (Fresh Core Plumbing) — not started
Plan: 0/TBD in current phase
Status: Not started
Last activity: 2026-02-25 — Milestone v1 complete; v2 roadmap created (phases 6–10)

Progress: [█████░░░░░] 50% — v1 complete (9/9 plans); v2 pending

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
| 06-fresh-core-plumbing | 0/TBD | — | — |
| 07-effect-package | 0/TBD | — | — |
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

### Pending Todos

None — Phase 6 plans not yet created. Run `/gsd:plan-phase 6` to begin.

### Blockers/Concerns

None known. v1 integration tests must stay green throughout v2 — each phase gated
on prior phase tests passing.

## Session Continuity

Last session: 2026-02-25
Stopped at: v2 roadmap created — Phase 6 (Fresh Core Plumbing) is next
Resume file: None
