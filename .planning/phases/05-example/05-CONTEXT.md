# Phase 5: Example - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A runnable kitchen-sink app in `packages/examples/effect-integration/` that demonstrates
every Fresh capability wired through the Effect integration built in Phases 1-4.
Routes, islands, middleware, layouts, partials, static files, error pages, and RPC —
all powered by Effect-returning handlers with a typed Layer.

</domain>

<decisions>
## Implementation Decisions

### Example scope
- Full kitchen-sink: demonstrate ALL Fresh capabilities (routes, islands, middleware,
  layouts, partials, static files, error pages, RPC)
- Lives as a workspace package in `packages/examples/effect-integration/` with standard
  deno.json workspace imports — not a standalone starter
- Claude's discretion on annotation level (comments explaining "this demonstrates X"
  vs clean self-explanatory code)

### Service layer design
- Domain: Todo list (CRUD)
- Persistence: Deno KV via `@effect/platform-deno` (published package name in import map,
  not relative path to sibling repo)
- Import map maps to published package names — example should work with published
  `@effect/platform-deno` from JSR/npm
- Claude's discretion on number of services — single TodoService backed by KV is the
  minimum; additional services (e.g., ConfigService) acceptable if they demonstrate
  Layer.merge composition without overcomplicating

### Island interaction
- Full CRUD UI: list todos, add new, toggle complete, delete
- Mutations: RPC round-trip with optimistic client-side updates — update atom
  immediately, then sync via RPC. Server is source of truth; rollback on failure.
- Styling: Tailwind CSS
- Claude's discretion on island decomposition — single TodoApp island or multiple
  islands (TodoList, TodoInput, TodoStats) sharing atoms across island boundaries

### Error showcase
- Both: natural errors in todo flow (not found, KV failure) + dedicated error route
  showing typed error dispatch explicitly
- Proper public/internal error segregation: public errors are user-safe HTTP responses,
  internal errors are logged server-side only
- Claude designs the error segregation pattern (TaggedErrors + mapError, middleware
  boundary, or combination)
- Show Effect Cause inspection: log `Cause.pretty()` server-side for full error tracing
- Custom Fresh error page (500.tsx) — styled, user-friendly, demonstrates full error
  rendering path

### Claude's Discretion
- Annotation level (tutorial comments vs clean code)
- Number and composition of Effect services in the Layer
- Island decomposition strategy (single vs multiple islands)
- Error segregation pattern design (TaggedErrors + mapError recommended)
- Exact Tailwind styling and layout

</decisions>

<specifics>
## Specific Ideas

- Use `@effect/platform-deno` KV capabilities to show off the platform-deno package
  (maps to published package name in import map)
- RPC with optimistic updates — update atom immediately, sync via RPC, rollback on
  failure. Shows the atom + RPC interplay.
- Full CRUD demonstrates all atom hooks: useAtom (read+write), useAtomValue (read-only
  for display), useAtomSet (write-only for mutations)
- Cause.pretty() logged server-side shows Effect's error tracing value beyond standard
  stack traces

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-example*
*Context gathered: 2026-02-24*
